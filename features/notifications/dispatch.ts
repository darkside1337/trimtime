import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationAttempts } from "@/db/schema/notification-attempts";
import { notificationWork } from "@/db/schema/notification-work";
import { resolveEmailConfig } from "./config";
import type { BookingMessageSnapshot, OutboundMessage } from "./messages";
import {
  evaluateNotificationEligibility,
  type NotificationKind,
} from "./eligibility";
import { buildNotificationMessage } from "./rendering";
import { sendMailpitMessage, type MailpitTransportResult } from "./mailpit";
import { getNextRetryAt } from "./retry-policy";

export type DispatchDependencies = {
  now?: () => Date;
  send?: (input: {
    origin: string;
    message: OutboundMessage;
    attemptId: string;
    onInvoked: () => Promise<void>;
    onAccepted?: (captureId: string) => Promise<void>;
  }) => Promise<MailpitTransportResult>;
};

type CurrentBooking = BookingMessageSnapshot & {
  id: string;
  status: string;
  revision: number;
  customerPhone: string | null;
  capabilityHash: string;
  capabilityCiphertext: string;
  capabilityKeyId: string;
  capabilityRevokedAt: Date | null;
  shopId: string;
  subdomain: string;
  ownerEmail: string | null;
};

async function suppress(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workId: string,
  status: "skipped" | "suppressed" | "unavailable",
  reason: string,
  now: Date,
) {
  await tx
    .update(notificationWork)
    .set({ status, reason, nextAttemptAt: null, updatedAt: now })
    .where(
      sql`${notificationWork.id}=${workId} AND ${notificationWork.status} IN ('not_attempted','failed')`,
    );
}

async function authorize(input: {
  bookingId: string;
  workId: string;
  retry: boolean;
  dependencies: Required<DispatchDependencies>;
}) {
  return db.transaction(async (tx) => {
    const location = await tx.execute(
      sql`SELECT shop_id AS "shopId" FROM bookings WHERE id=${input.bookingId}`,
    );
    const shopId =
      location.rows[0] &&
      String((location.rows[0] as { shopId: string }).shopId);
    if (!shopId) return null;

    await tx.execute(sql`SELECT id FROM shops WHERE id=${shopId} FOR UPDATE`);
    const bookingResult = await tx.execute(sql`
      SELECT b.id, b.shop_id AS "shopId", b.status, b.revision, b.start_at AS "startAt", b.end_at AS "endAt",
        b.service_name AS "serviceName", b.service_price_usd AS "servicePriceUsd",
        b.service_duration_minutes AS "serviceDurationMinutes", b.barber_name AS "barberName",
        b.customer_name AS "customerName", b.customer_email AS "customerEmail",
        b.customer_phone AS "customerPhone", b.capability_hash AS "capabilityHash",
        b.capability_ciphertext AS "capabilityCiphertext", b.capability_key_id AS "capabilityKeyId",
        b.capability_revoked_at AS "capabilityRevokedAt", s.subdomain,
        s.name AS "shopName", s.address AS "shopAddress", s.public_contact AS "shopPublicContact",
        s.time_zone AS "shopTimeZone", u.email AS "ownerEmail"
      FROM bookings b JOIN shops s ON s.id=b.shop_id JOIN "user" u ON u.id=s.owner_id
      WHERE b.id=${input.bookingId} FOR UPDATE OF b
    `);
    const rawBooking = bookingResult.rows[0] as
      Record<string, unknown> | undefined;
    const workResult = await tx.execute(sql`
      SELECT w.id, w.kind, w.status, w.recipient, w.booking_revision AS "bookingRevision",
        w.content_identity AS "contentIdentity", w.next_attempt_at AS "nextAttemptAt",
        w.due_at AS "dueAt",
        c.before_snapshot AS "beforeSnapshot",
        c.kind AS "changeKind", c.actor_type AS "changeActor",
        c.applied_revision AS "changeRevision"
      FROM notification_work w
      LEFT JOIN booking_changes c ON c.id=w.change_id AND c.booking_id=w.booking_id
      WHERE w.id=${input.workId} AND w.booking_id=${input.bookingId} AND w.channel='email'
      FOR UPDATE OF w
    `);
    const rawWork = workResult.rows[0] as Record<string, unknown> | undefined;
    if (!rawBooking || !rawWork) return null;

    const now = input.dependencies.now();
    const kind = String(rawWork.kind) as NotificationKind;
    if (
      kind === "customer_reminder" &&
      rawWork.dueAt &&
      new Date(rawWork.dueAt as Date | string).getTime() > now.getTime()
    ) {
      return null;
    }
    const priorAttempts = await tx.execute(sql`
      SELECT id, attempt_number AS "attemptNumber", outcome, reason
      FROM notification_attempts WHERE work_id=${input.workId}
      ORDER BY attempt_number DESC FOR UPDATE
    `);
    const latestAttempt = priorAttempts.rows[0] as
      | { attemptNumber: number; outcome: string | null; reason: string | null }
      | undefined;
    const nextAttemptAt =
      rawWork.nextAttemptAt === null || rawWork.nextAttemptAt === undefined
        ? Number.NaN
        : new Date(rawWork.nextAttemptAt as string | Date).getTime();
    const retryDue =
      input.retry &&
      rawWork.status === "failed" &&
      Number.isFinite(nextAttemptAt) &&
      nextAttemptAt <= now.getTime() &&
      latestAttempt?.outcome === "failed" &&
      latestAttempt.reason === "transient_rejection" &&
      Number(latestAttempt.attemptNumber) < 3;
    const initialEligible =
      rawWork.status === "not_attempted" && priorAttempts.rows.length === 0;
    if (!(input.retry ? retryDue || initialEligible : initialEligible))
      return null;

    const booking: CurrentBooking = {
      id: String(rawBooking.id),
      shopId: String(rawBooking.shopId),
      status: String(rawBooking.status),
      revision: Number(rawBooking.revision),
      startAt: rawBooking.startAt as Date,
      endAt: rawBooking.endAt as Date,
      serviceName: String(rawBooking.serviceName),
      servicePriceUsd: String(rawBooking.servicePriceUsd),
      serviceDurationMinutes: Number(rawBooking.serviceDurationMinutes),
      barberName: String(rawBooking.barberName),
      customerName: String(rawBooking.customerName),
      customerEmail: rawBooking.customerEmail as string | null,
      customerPhone: rawBooking.customerPhone as string | null,
      capabilityHash: String(rawBooking.capabilityHash),
      capabilityCiphertext: String(rawBooking.capabilityCiphertext),
      capabilityKeyId: String(rawBooking.capabilityKeyId),
      capabilityRevokedAt: rawBooking.capabilityRevokedAt as Date | null,
      subdomain: String(rawBooking.subdomain),
      ownerEmail: rawBooking.ownerEmail as string | null,
      shop: {
        name: String(rawBooking.shopName),
        address: String(rawBooking.shopAddress),
        publicContact: String(rawBooking.shopPublicContact),
        timeZone: String(rawBooking.shopTimeZone),
      },
    };
    const config = resolveEmailConfig(process.env);
    const emailAvailable = config.mode === "mailpit";
    const emailOrigin = emailAvailable ? config.origin : "";
    const emailUnavailableReason = emailAvailable ? "" : config.reason;
    const workRevision = Number(rawWork.bookingRevision);
    const changeKind = rawWork.changeKind as string | null;
    const changeActor = rawWork.changeActor as string | null;
    const changeRevision =
      rawWork.changeRevision === null ? null : Number(rawWork.changeRevision);
    const eligibility = evaluateNotificationEligibility({
      kind,
      booking,
      bookingId: booking.id,
      workRevision,
      changeKind,
      changeActor,
      changeRevision,
      recipient: rawWork.recipient as string | null,
      ownerEmail: booking.ownerEmail,
      expectedContentIdentity: String(rawWork.contentIdentity),
      now,
      emailAvailable,
      emailUnavailableReason,
    });
    if (!eligibility.eligible) {
      await suppress(
        tx,
        input.workId,
        eligibility.status,
        eligibility.reason,
        now,
      );
      return { suppressed: true as const, result: eligibility.status };
    }

    const rendering = buildNotificationMessage({
      kind,
      booking,
      recipient: eligibility.recipient,
      beforeSnapshot: rawWork.beforeSnapshot as {
        startAt: string;
        endAt: string;
      } | null,
      changeActor,
      activityUrl: `${process.env.APP_ORIGIN}/activity`,
    });
    if (!rendering.ok) {
      await suppress(tx, input.workId, rendering.status, rendering.reason, now);
      return { suppressed: true as const, result: rendering.status };
    }
    let authorizedAt = input.dependencies.now();
    let day = authorizedAt.toISOString().slice(0, 10);
    let allocation = await tx.execute(sql`
      INSERT INTO outbound_budget (day, allocation_count) VALUES (${day}, 1)
      ON CONFLICT (day) DO UPDATE
      SET allocation_count = outbound_budget.allocation_count + 1
      WHERE outbound_budget.allocation_count < 100
      RETURNING allocation_count
    `);

    // The upsert can wait on another transaction. Authorization time is the
    // first clock sample after that wait, including when the day is exhausted.
    authorizedAt = input.dependencies.now();
    let authorizedDay = authorizedAt.toISOString().slice(0, 10);
    while (authorizedDay !== day) {
      if (allocation.rows.length) {
        await tx.execute(sql`
          UPDATE outbound_budget SET allocation_count=allocation_count-1
          WHERE day=${day} AND allocation_count > 0
        `);
      }
      day = authorizedDay;
      allocation = await tx.execute(sql`
        INSERT INTO outbound_budget (day, allocation_count) VALUES (${day}, 1)
        ON CONFLICT (day) DO UPDATE
        SET allocation_count = outbound_budget.allocation_count + 1
        WHERE outbound_budget.allocation_count < 100
        RETURNING allocation_count
      `);
      authorizedAt = input.dependencies.now();
      authorizedDay = authorizedAt.toISOString().slice(0, 10);
    }

    if (kind === "customer_reminder") {
      const dueAt = new Date(rawWork.dueAt as Date | string).getTime();
      if (dueAt > authorizedAt.getTime()) {
        if (allocation.rows.length) {
          await tx.execute(sql`
            UPDATE outbound_budget SET allocation_count=allocation_count-1
            WHERE day=${day} AND allocation_count > 0
          `);
        }
        return null;
      }
      if (new Date(booking.startAt).getTime() <= authorizedAt.getTime()) {
        if (allocation.rows.length) {
          await tx.execute(sql`
            UPDATE outbound_budget SET allocation_count=allocation_count-1
            WHERE day=${day} AND allocation_count > 0
          `);
        }
        await suppress(
          tx,
          input.workId,
          "suppressed",
          "work_no_longer_eligible",
          authorizedAt,
        );
        return { suppressed: true as const, result: "suppressed" as const };
      }
    }
    if (
      new Date(booking.endAt).getTime() + 7 * 24 * 60 * 60_000 <=
      authorizedAt.getTime()
    ) {
      if (allocation.rows.length) {
        await tx.execute(sql`
          UPDATE outbound_budget SET allocation_count=allocation_count-1
          WHERE day=${day} AND allocation_count > 0
        `);
      }
      await suppress(
        tx,
        input.workId,
        "suppressed",
        "work_no_longer_eligible",
        authorizedAt,
      );
      return { suppressed: true as const, result: "suppressed" as const };
    }
    if (!allocation.rows.length) {
      await suppress(
        tx,
        input.workId,
        "skipped",
        "daily_budget_exhausted",
        authorizedAt,
      );
      return { suppressed: true as const, result: "skipped" as const };
    }

    const attemptId = randomUUID();
    const claimId = randomUUID();
    await tx.insert(notificationAttempts).values({
      id: attemptId,
      workId: input.workId,
      budgetDay: day,
      attemptNumber: latestAttempt
        ? Number(latestAttempt.attemptNumber) + 1
        : 1,
    });
    await tx
      .update(notificationWork)
      .set({
        status: "sending",
        claimedAt: authorizedAt,
        claimId,
        updatedAt: authorizedAt,
      })
      .where(
        input.retry
          ? sql`${notificationWork.id}=${input.workId} AND ${notificationWork.status} IN ('not_attempted','failed')`
          : sql`${notificationWork.id}=${input.workId} AND ${notificationWork.status}='not_attempted'`,
      );
    return {
      message: rendering.message,
      origin: emailOrigin,
      attemptId,
      claimId,
      authorizedAt,
      suppressed: false as const,
    };
  });
}

async function finish(input: {
  workId: string;
  attemptId: string;
  claimId: string;
  result: MailpitTransportResult;
  now: Date;
}) {
  await db.transaction(async (tx) => {
    const [work] = await tx
      .select({ id: notificationWork.id })
      .from(notificationWork)
      .where(
        sql`${notificationWork.id}=${input.workId} AND ${notificationWork.claimId}=${input.claimId} AND ${notificationWork.status} IN ('sending','accepted')`,
      )
      .for("update");
    if (!work) return;
    const [attempt] = await tx
      .select({ id: notificationAttempts.id })
      .from(notificationAttempts)
      .where(
        sql`${notificationAttempts.id}=${input.attemptId} AND ${notificationAttempts.workId}=${input.workId}`,
      )
      .for("update");
    if (!attempt) return;
    const [numberedAttempt] = await tx
      .select({ attemptNumber: notificationAttempts.attemptNumber })
      .from(notificationAttempts)
      .where(sql`${notificationAttempts.id}=${input.attemptId}`)
      .for("update");
    if (!numberedAttempt) return;
    const nextAttemptAt = getNextRetryAt({
      attemptNumber: numberedAttempt.attemptNumber,
      reason: input.result.reason,
      finishedAt: input.now,
    });
    const updatedAttempt = await tx
      .update(notificationAttempts)
      .set({
        outcome: input.result.status,
        captureId: input.result.captureId,
        reason: input.result.reason,
        finishedAt: input.now,
      })
      .where(
        sql`${notificationAttempts.id}=${input.attemptId} AND ${notificationAttempts.workId}=${input.workId}`,
      )
      .returning({ id: notificationAttempts.id });
    if (!updatedAttempt.length) return;
    await tx
      .update(notificationWork)
      .set({
        status: input.result.status,
        reason: input.result.reason,
        nextAttemptAt,
        updatedAt: input.now,
      })
      .where(
        sql`${notificationWork.id}=${input.workId} AND ${notificationWork.claimId}=${input.claimId} AND ${notificationWork.status} IN ('sending','accepted')`,
      );
  });
}

type DispatchTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockCurrentAttempt(
  tx: DispatchTransaction,
  input: { workId: string; attemptId: string; claimId: string },
) {
  const [work] = await tx
    .select({ id: notificationWork.id })
    .from(notificationWork)
    .where(
      sql`${notificationWork.id}=${input.workId} AND ${notificationWork.claimId}=${input.claimId} AND ${notificationWork.status}='sending'`,
    )
    .for("update");
  if (!work) return false;

  const [attempt] = await tx
    .select({ id: notificationAttempts.id })
    .from(notificationAttempts)
    .where(
      sql`${notificationAttempts.id}=${input.attemptId} AND ${notificationAttempts.workId}=${input.workId}`,
    )
    .for("update");
  return Boolean(attempt);
}

export async function dispatchInitialBookingNotifications(
  bookingId: string,
  injected: DispatchDependencies = {},
) {
  const dependencies: Required<DispatchDependencies> = {
    now: injected.now ?? (() => new Date()),
    send: injected.send ?? sendMailpitMessage,
  };
  const items = await db.execute(sql`
    SELECT id FROM notification_work WHERE booking_id=${bookingId} AND channel='email'
    ORDER BY CASE WHEN kind IN ('customer_confirmation', 'customer_move', 'customer_cancellation', 'customer_restoration') THEN 0 ELSE 1 END
  `);
  for (const row of items.rows as { id: string }[]) {
    await dispatchNotificationWork(bookingId, row.id, false, dependencies);
  }
}

export async function dispatchNotificationWork(
  bookingId: string,
  workId: string,
  allowRetry: boolean,
  injected: DispatchDependencies = {},
): Promise<"attempted" | "suppressed" | "skipped" | "unavailable"> {
  const dependencies: Required<DispatchDependencies> = {
    now: injected.now ?? (() => new Date()),
    send: injected.send ?? sendMailpitMessage,
  };
  let wasReserved = false;
  try {
    const authorized = await authorize({
      bookingId,
      workId,
      retry: allowRetry,
      dependencies,
    });
    if (!authorized) return "skipped";
    if (authorized.suppressed) {
      if (authorized.result === "suppressed") return "suppressed";
      if (authorized.result === "unavailable") return "unavailable";
      return "skipped";
    }
    wasReserved = true;
    let result: MailpitTransportResult;
    try {
      result = await dependencies.send({
        origin: authorized.origin,
        message: authorized.message,
        attemptId: authorized.attemptId,
        onInvoked: async () => {
          await db.transaction(async (tx) => {
            if (
              !(await lockCurrentAttempt(tx, {
                workId,
                attemptId: authorized.attemptId,
                claimId: authorized.claimId,
              }))
            )
              return;
            await tx
              .update(notificationAttempts)
              .set({ invokedAt: dependencies.now() })
              .where(
                sql`${notificationAttempts.id}=${authorized.attemptId} AND ${notificationAttempts.workId}=${workId}`,
              );
          });
        },
        onAccepted: async (captureId) => {
          await db.transaction(async (tx) => {
            if (
              !(await lockCurrentAttempt(tx, {
                workId,
                attemptId: authorized.attemptId,
                claimId: authorized.claimId,
              }))
            )
              return;
            const updatedWork = await tx
              .update(notificationWork)
              .set({ status: "accepted", updatedAt: dependencies.now() })
              .where(
                sql`${notificationWork.id}=${workId} AND ${notificationWork.claimId}=${authorized.claimId} AND ${notificationWork.status}='sending'`,
              )
              .returning({ id: notificationWork.id });
            if (!updatedWork.length) return;
            const updatedAttempt = await tx
              .update(notificationAttempts)
              .set({ outcome: "accepted", captureId })
              .where(
                sql`${notificationAttempts.id}=${authorized.attemptId} AND ${notificationAttempts.workId}=${workId}`,
              )
              .returning({ id: notificationAttempts.id });
            if (!updatedAttempt.length)
              throw new Error("Current notification attempt disappeared.");
          });
        },
      });
    } catch {
      result = {
        status: "unknown",
        reason: "transport_interrupted",
        captureId: null,
        invoked: false,
      };
    }
    if (!result.invoked)
      result = {
        ...result,
        status: "unknown",
        reason: result.reason ?? "transport_interrupted",
      };
    await finish({
      workId,
      attemptId: authorized.attemptId,
      claimId: authorized.claimId,
      result,
      now: dependencies.now(),
    });
    return "attempted";
  } catch (error) {
    console.error("Notification dispatch failed.", { bookingId, workId });
    if (allowRetry) throw error;
    return wasReserved ? "attempted" : "skipped";
  }
}
