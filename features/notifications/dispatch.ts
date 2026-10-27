import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationAttempts } from "@/db/schema/notification-attempts";
import { notificationWork } from "@/db/schema/notification-work";
import { resolveEmailConfig } from "./config";
import {
  canonicalManageUrl,
  decryptCapability,
  hashSecret,
} from "@/features/bookings/capabilities";
import { notificationContentIdentity } from "./content-identity";
import {
  renderCustomerConfirmation,
  renderOwnerAlert,
  type BookingMessageSnapshot,
  type OutboundMessage,
} from "./messages";
import { sendMailpitMessage, type MailpitTransportResult } from "./mailpit";

type DispatchDependencies = {
  now?: () => Date;
  send?: (input: {
    origin: string;
    message: OutboundMessage;
    attemptId: string;
    onInvoked: () => Promise<void>;
  }) => Promise<MailpitTransportResult>;
};

type CurrentBooking = BookingMessageSnapshot & {
  id: string;
  status: string;
  customerPhone: string | null;
  capabilityHash: string;
  capabilityCiphertext: string;
  capabilityKeyId: string;
  capabilityRevokedAt: Date | null;
  shopId: string;
  subdomain: string;
  ownerEmail: string | null;
};

function contentIdentity(booking: CurrentBooking) {
  return notificationContentIdentity({
    id: booking.id,
    startAt: booking.startAt,
    endAt: booking.endAt,
    serviceName: booking.serviceName,
    servicePriceUsd: booking.servicePriceUsd,
    serviceDurationMinutes: booking.serviceDurationMinutes,
    barberName: booking.barberName,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    customerPhone: booking.customerPhone,
  });
}

async function suppress(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workId: string,
  status: "skipped" | "suppressed" | "unavailable",
  reason: string,
  now: Date,
) {
  await tx
    .update(notificationWork)
    .set({ status, reason, updatedAt: now })
    .where(
      sql`${notificationWork.id}=${workId} AND ${notificationWork.status}='not_attempted'`,
    );
}

async function authorize(input: {
  bookingId: string;
  workId: string;
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
      SELECT b.id, b.shop_id AS "shopId", b.status, b.start_at AS "startAt", b.end_at AS "endAt",
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
      SELECT id, kind, status, recipient, content_identity AS "contentIdentity"
      FROM notification_work
      WHERE id=${input.workId} AND booking_id=${input.bookingId} AND channel='email'
      FOR UPDATE
    `);
    const rawWork = workResult.rows[0] as Record<string, unknown> | undefined;
    if (!rawBooking || !rawWork || rawWork.status !== "not_attempted")
      return null;

    const now = input.dependencies.now();
    const booking: CurrentBooking = {
      id: String(rawBooking.id),
      shopId: String(rawBooking.shopId),
      status: String(rawBooking.status),
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
    if (config.mode !== "mailpit") {
      await suppress(tx, input.workId, "unavailable", config.reason, now);
      return null;
    }
    const kind = String(rawWork.kind);
    const recipient = rawWork.recipient as string | null;
    if (!recipient) {
      await suppress(tx, input.workId, "skipped", "recipient_missing", now);
      return null;
    }
    const expectedRecipient =
      kind === "customer_confirmation"
        ? booking.customerEmail
        : booking.ownerEmail;
    if (
      (kind !== "customer_confirmation" && kind !== "owner_alert") ||
      booking.status !== "confirmed" ||
      booking.capabilityRevokedAt ||
      new Date(booking.endAt).getTime() + 7 * 24 * 60 * 60_000 <=
        now.getTime() ||
      recipient !== expectedRecipient ||
      rawWork.contentIdentity !== contentIdentity(booking)
    ) {
      await suppress(
        tx,
        input.workId,
        "suppressed",
        "work_no_longer_eligible",
        now,
      );
      return null;
    }

    let message: OutboundMessage;
    try {
      if (kind === "customer_confirmation") {
        let token: string;
        try {
          token = decryptCapability(
            booking.capabilityCiphertext,
            booking.capabilityKeyId,
            `${booking.shopId}:${booking.id}`,
          );
          if (hashSecret(token) !== booking.capabilityHash)
            throw new Error("Capability mismatch.");
        } catch {
          await suppress(
            tx,
            input.workId,
            "skipped",
            "capability_unavailable",
            now,
          );
          return null;
        }
        message = renderCustomerConfirmation({
          booking,
          recipient,
          manageUrl: canonicalManageUrl(booking.subdomain, token),
        });
      } else {
        message = renderOwnerAlert({
          booking,
          recipient,
          activityUrl: `${process.env.APP_ORIGIN}/activity`,
        });
      }
    } catch {
      await suppress(tx, input.workId, "skipped", "message_render_failed", now);
      return null;
    }
    const authorizedAt = input.dependencies.now();
    if (
      new Date(booking.endAt).getTime() + 7 * 24 * 60 * 60_000 <=
      authorizedAt.getTime()
    ) {
      await suppress(
        tx,
        input.workId,
        "suppressed",
        "work_no_longer_eligible",
        authorizedAt,
      );
      return null;
    }
    const day = authorizedAt.toISOString().slice(0, 10);
    const allocation = await tx.execute(sql`
      INSERT INTO outbound_budget (day, allocation_count) VALUES (${day}, 1)
      ON CONFLICT (day) DO UPDATE
      SET allocation_count = outbound_budget.allocation_count + 1
      WHERE outbound_budget.allocation_count < 100
      RETURNING allocation_count
    `);
    if (!allocation.rows.length) {
      await suppress(
        tx,
        input.workId,
        "skipped",
        "daily_budget_exhausted",
        authorizedAt,
      );
      return null;
    }

    const attemptId = randomUUID();
    const claimId = randomUUID();
    await tx
      .insert(notificationAttempts)
      .values({ id: attemptId, workId: input.workId, budgetDay: day });
    await tx
      .update(notificationWork)
      .set({
        status: "sending",
        claimedAt: authorizedAt,
        claimId,
        updatedAt: authorizedAt,
      })
      .where(
        sql`${notificationWork.id}=${input.workId} AND ${notificationWork.status}='not_attempted'`,
      );
    return { message, origin: config.origin, attemptId, claimId, authorizedAt };
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
        sql`${notificationWork.id}=${input.workId} AND ${notificationWork.claimId}=${input.claimId} AND ${notificationWork.status}='sending'`,
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
    const updatedAttempt = await tx
      .update(notificationAttempts)
      .set({ outcome: input.result.status, captureId: input.result.captureId })
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
        updatedAt: input.now,
      })
      .where(
        sql`${notificationWork.id}=${input.workId} AND ${notificationWork.claimId}=${input.claimId}`,
      );
  });
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
    ORDER BY CASE WHEN kind='customer_confirmation' THEN 0 ELSE 1 END
  `);
  for (const row of items.rows as { id: string }[]) {
    try {
      const authorized = await authorize({
        bookingId,
        workId: row.id,
        dependencies,
      });
      if (!authorized) continue;
      let result: MailpitTransportResult;
      try {
        result = await dependencies.send({
          origin: authorized.origin,
          message: authorized.message,
          attemptId: authorized.attemptId,
          onInvoked: async () => {
            await db
              .update(notificationAttempts)
              .set({ invokedAt: dependencies.now() })
              .where(
                sql`${notificationAttempts.id}=${authorized.attemptId} AND ${notificationAttempts.workId}=${row.id} AND EXISTS (SELECT 1 FROM notification_work WHERE id=${row.id} AND claim_id=${authorized.claimId} AND status='sending')`,
              );
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
        workId: row.id,
        attemptId: authorized.attemptId,
        claimId: authorized.claimId,
        result,
        now: dependencies.now(),
      });
    } catch {
      console.error("Notification dispatch failed.", {
        bookingId,
        workId: row.id,
      });
    }
  }
}
