import "server-only";
import { bookingChanges } from "@/db/schema/booking-changes";
import type { BookingTransaction } from "../creation-primitives";
import { findShopChangeReplay } from "../change-primitives";

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
  const row = await findShopChangeReplay(tx, params);
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    appliedRevision: row.appliedRevision,
    committedAt: row.committedAt,
    afterSnapshot: row.afterSnapshot,
    payloadDigest: row.payloadDigest,
  };
}
