import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationAttempts } from "@/db/schema/notification-attempts";
import { notificationWork } from "@/db/schema/notification-work";
import { resolveEmailConfig } from "./config";
import { verifyMailpitCapture } from "./mailpit";
import {
  dispatchNotificationWork,
  type DispatchDependencies,
} from "./dispatch";

export type NotificationRetrySummary = {
  processed: number;
  attempted: number;
  reconciled: number;
  recoveredUnknown: number;
  suppressed: number;
};

export type RetryCandidate = { id: string; bookingId: string; status: string };
export type RetryWorkerDependencies = DispatchDependencies & {
  verifyCapture?: (input: {
    origin: string;
    captureId: string;
    recipient: string;
    attemptId: string;
  }) => Promise<string | null>;
};

async function selectCandidates(now: Date): Promise<RetryCandidate[]> {
  const staleBefore = new Date(now.getTime() - 30_000);
  const result = await db.execute(sql`
    SELECT w.id, w.booking_id AS "bookingId", w.status
    FROM notification_work w
    WHERE w.channel='email'
      AND (w.status='not_attempted'
        OR (w.status='failed' AND w.next_attempt_at <= ${now})
        OR (w.status='sending' AND w.claimed_at < ${staleBefore})
        OR (w.status='accepted' AND EXISTS (
          SELECT 1 FROM notification_attempts a WHERE a.work_id=w.id AND a.capture_id IS NOT NULL
        )))
    ORDER BY CASE
      WHEN w.status='failed' THEN w.next_attempt_at
      WHEN w.status='sending' THEN w.claimed_at + interval '30 seconds'
      WHEN w.status='accepted' THEN w.updated_at
      ELSE w.created_at
    END ASC, w.id ASC
    LIMIT 5
  `);
  return result.rows as RetryCandidate[];
}

async function recoverStaleClaim(candidate: RetryCandidate, now: Date) {
  return db.transaction(async (tx) => {
    const location = await tx.execute(
      sql`SELECT shop_id AS "shopId" FROM bookings WHERE id=${candidate.bookingId}`,
    );
    const shopId =
      location.rows[0] &&
      String((location.rows[0] as { shopId: string }).shopId);
    if (!shopId) return false;
    await tx.execute(sql`SELECT id FROM shops WHERE id=${shopId} FOR UPDATE`);
    await tx.execute(
      sql`SELECT id FROM bookings WHERE id=${candidate.bookingId} FOR UPDATE`,
    );
    const workResult = await tx.execute(sql`
      SELECT claim_id AS "claimId",claimed_at AS "claimedAt"
      FROM notification_work
      WHERE id=${candidate.id} AND booking_id=${candidate.bookingId} AND channel='email' AND status='sending'
      FOR UPDATE
    `);
    const work = workResult.rows[0] as
      { claimId: string | null; claimedAt: Date | string | null } | undefined;
    if (!work?.claimId || !work.claimedAt) return false;
    const claimedAt = new Date(work.claimedAt).getTime();
    if (!(claimedAt < now.getTime() - 30_000)) return false;
    const attempts = await tx.execute(sql`
      SELECT id FROM notification_attempts
      WHERE work_id=${candidate.id} AND outcome IS NULL
      ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE
    `);
    const attemptId =
      attempts.rows[0] && String((attempts.rows[0] as { id: string }).id);
    if (!attemptId) return false;
    const attemptUpdate = await tx.execute(sql`
      UPDATE notification_attempts
      SET outcome='unknown',reason='dispatch_interrupted',finished_at=${now}
      WHERE id=${attemptId} AND work_id=${candidate.id} AND outcome IS NULL
      RETURNING id
    `);
    if (!attemptUpdate.rows.length) return false;
    const workUpdate = await tx.execute(sql`
      UPDATE notification_work
      SET status='unknown',reason='dispatch_interrupted',next_attempt_at=NULL,
          claimed_at=NULL,claim_id=NULL,updated_at=${now}
      WHERE id=${candidate.id} AND claim_id=${work.claimId} AND status='sending'
      RETURNING id
    `);
    return workUpdate.rows.length > 0;
  });
}

async function reconcileKnownCapture(
  candidate: RetryCandidate,
  injected: RetryWorkerDependencies,
) {
  const evidence = await db.execute(sql`
    SELECT w.status,w.recipient,w.claim_id AS "claimId",
      a.id AS "attemptId",a.capture_id AS "captureId",a.outcome
    FROM notification_work w JOIN notification_attempts a ON a.work_id=w.id
    WHERE w.id=${candidate.id} AND w.booking_id=${candidate.bookingId} AND w.channel='email'
    ORDER BY a.attempt_number DESC LIMIT 1
  `);
  const row = evidence.rows[0] as
    | {
        status: string;
        recipient: string | null;
        claimId: string | null;
        attemptId: string;
        captureId: string | null;
        outcome: string | null;
      }
    | undefined;
  if (
    row?.status !== "accepted" ||
    row.outcome !== "accepted" ||
    !row.captureId ||
    !row.recipient
  )
    return false;
  const config = resolveEmailConfig(process.env);
  if (config.mode !== "mailpit") return false;
  let verificationReason: string | null;
  try {
    verificationReason = await (injected.verifyCapture ?? verifyMailpitCapture)(
      {
        origin: config.origin,
        captureId: row.captureId,
        recipient: row.recipient,
        attemptId: row.attemptId,
      },
    );
  } catch {
    return false;
  }
  if (verificationReason !== null) return false;

  return db.transaction(async (tx) => {
    const location = await tx.execute(
      sql`SELECT shop_id AS "shopId" FROM bookings WHERE id=${candidate.bookingId}`,
    );
    const shopId =
      location.rows[0] &&
      String((location.rows[0] as { shopId: string }).shopId);
    if (!shopId) return false;
    await tx.execute(sql`SELECT id FROM shops WHERE id=${shopId} FOR UPDATE`);
    await tx.execute(
      sql`SELECT id FROM bookings WHERE id=${candidate.bookingId} FOR UPDATE`,
    );
    const [work] = await tx
      .select({ id: notificationWork.id })
      .from(notificationWork)
      .where(
        sql`${notificationWork.id}=${candidate.id} AND ${notificationWork.bookingId}=${candidate.bookingId} AND ${notificationWork.channel}='email' AND ${notificationWork.status}='accepted' AND ${notificationWork.claimId} IS NOT DISTINCT FROM ${row.claimId}`,
      )
      .for("update");
    if (!work) return false;
    const [attempt] = await tx
      .select({ id: notificationAttempts.id })
      .from(notificationAttempts)
      .where(
        sql`${notificationAttempts.id}=${row.attemptId} AND ${notificationAttempts.workId}=${candidate.id} AND ${notificationAttempts.outcome}='accepted' AND ${notificationAttempts.captureId}=${row.captureId}`,
      )
      .for("update");
    if (!attempt) return false;
    const updatedAttempt = await tx
      .update(notificationAttempts)
      .set({ outcome: "captured", reason: null })
      .where(
        sql`${notificationAttempts.id}=${row.attemptId} AND ${notificationAttempts.outcome}='accepted'`,
      )
      .returning({ id: notificationAttempts.id });
    if (!updatedAttempt.length) return false;
    const updatedWork = await tx
      .update(notificationWork)
      .set({
        status: "captured",
        reason: null,
        nextAttemptAt: null,
        updatedAt: injected.now?.() ?? new Date(),
      })
      .where(
        sql`${notificationWork.id}=${candidate.id} AND ${notificationWork.status}='accepted' AND ${notificationWork.claimId} IS NOT DISTINCT FROM ${row.claimId}`,
      )
      .returning({ id: notificationWork.id });
    return updatedWork.length > 0;
  });
}

async function processCandidates(
  candidates: RetryCandidate[],
  injected: RetryWorkerDependencies,
): Promise<NotificationRetrySummary> {
  const summary: NotificationRetrySummary = {
    processed: 0,
    attempted: 0,
    reconciled: 0,
    recoveredUnknown: 0,
    suppressed: 0,
  };
  for (const candidate of candidates.slice(0, 5)) {
    summary.processed += 1;
    if (candidate.status === "sending") {
      if (await recoverStaleClaim(candidate, injected.now?.() ?? new Date())) {
        summary.recoveredUnknown += 1;
      }
      continue;
    }
    if (candidate.status === "accepted") {
      if (await reconcileKnownCapture(candidate, injected))
        summary.reconciled += 1;
      continue;
    }
    const dispatchResult = await dispatchNotificationWork(
      candidate.bookingId,
      candidate.id,
      true,
      injected,
    );
    if (dispatchResult === "attempted") {
      summary.attempted += 1;
    } else if (dispatchResult === "suppressed") {
      summary.suppressed += 1;
    }
  }
  return summary;
}

export async function processNotificationRetriesWithCandidateSource(
  injected: RetryWorkerDependencies,
  source: (now: Date) => Promise<RetryCandidate[]>,
): Promise<NotificationRetrySummary> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Candidate selection is test-only.");
  }
  const candidates = await source(injected.now?.() ?? new Date());
  return processCandidates(candidates, injected);
}

export async function processNotificationRetries(
  injected: RetryWorkerDependencies = {},
): Promise<NotificationRetrySummary> {
  const candidates = await selectCandidates(injected.now?.() ?? new Date());
  return processCandidates(candidates, injected);
}
