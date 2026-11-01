import "server-only";
import { and, eq } from "drizzle-orm";
import { bookingChanges } from "@/db/schema/booking-changes";
import type { BookingTransaction } from "../creation-primitives";

export type OwnerReplayRow = Pick<
  typeof bookingChanges.$inferSelect,
  | "id"
  | "kind"
  | "appliedRevision"
  | "committedAt"
  | "afterSnapshot"
  | "payloadDigest"
>;

export async function findOwnerChangeReplay(
  tx: BookingTransaction,
  params: { shopId: string; operationKeyHash: string },
): Promise<OwnerReplayRow | null> {
  const [row] = await tx
    .select({
      id: bookingChanges.id,
      kind: bookingChanges.kind,
      appliedRevision: bookingChanges.appliedRevision,
      committedAt: bookingChanges.committedAt,
      afterSnapshot: bookingChanges.afterSnapshot,
      payloadDigest: bookingChanges.payloadDigest,
    })
    .from(bookingChanges)
    .where(
      and(
        eq(bookingChanges.shopId, params.shopId),
        eq(bookingChanges.operationKeyHash, params.operationKeyHash),
      ),
    )
    .limit(1);

  return row ?? null;
}
