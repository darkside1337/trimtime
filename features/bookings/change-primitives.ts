import "server-only";
import { and, eq } from "drizzle-orm";
import { bookingChanges } from "@/db/schema/booking-changes";
import { services } from "@/db/schema/catalog";
import type { BookingTransaction } from "./creation-primitives";
import { fixedBookingPrice } from "./money";

export type ShopChangeReplayRow = Pick<
  typeof bookingChanges.$inferSelect,
  | "id"
  | "bookingId"
  | "actorType"
  | "kind"
  | "appliedRevision"
  | "committedAt"
  | "afterSnapshot"
  | "payloadDigest"
>;

export async function findShopChangeReplay(
  tx: BookingTransaction,
  params: { shopId: string; operationKeyHash: string },
): Promise<ShopChangeReplayRow | null> {
  const [row] = await tx
    .select({
      id: bookingChanges.id,
      bookingId: bookingChanges.bookingId,
      actorType: bookingChanges.actorType,
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

export type ChangeOfferSnapshot = {
  id: string;
  name: string;
  priceUsd: string;
  durationMinutes: number;
};

export type ReviewedChangeOffer = {
  name: string;
  priceUsd: string;
  durationMinutes: string;
};

export type ChangeOfferResolution =
  | { ok: true; service: ChangeOfferSnapshot }
  | { ok: false; reason: "unavailable" | "changed" };

export async function resolveChangeOffer(
  tx: BookingTransaction,
  params: {
    shopId: string;
    requestedServiceId: string;
    savedService: ChangeOfferSnapshot;
    reviewedOffer: ReviewedChangeOffer;
    retainedServiceMustBeNonarchived: boolean;
  },
): Promise<ChangeOfferResolution> {
  const retainingSavedService =
    params.requestedServiceId === params.savedService.id;

  if (retainingSavedService) {
    if (params.retainedServiceMustBeNonarchived) {
      const [service] = await tx
        .select({ id: services.id })
        .from(services)
        .where(
          and(
            eq(services.shopId, params.shopId),
            eq(services.id, params.requestedServiceId),
            eq(services.archived, false),
          ),
        )
        .limit(1);
      if (!service) return { ok: false, reason: "unavailable" };
    }

    if (!matchesReviewedOffer(params.savedService, params.reviewedOffer))
      return { ok: false, reason: "changed" };
    return { ok: true, service: params.savedService };
  }

  const [service] = await tx
    .select()
    .from(services)
    .where(
      and(
        eq(services.shopId, params.shopId),
        eq(services.id, params.requestedServiceId),
        eq(services.offered, true),
        eq(services.archived, false),
      ),
    )
    .limit(1);
  if (!service) return { ok: false, reason: "unavailable" };

  const currentOffer = {
    id: service.id,
    name: service.name,
    priceUsd: fixedBookingPrice(String(service.priceUsd)),
    durationMinutes: Number(service.durationMinutes),
  };
  if (!matchesReviewedOffer(currentOffer, params.reviewedOffer))
    return { ok: false, reason: "changed" };

  return { ok: true, service: currentOffer };
}

function matchesReviewedOffer(
  service: ChangeOfferSnapshot,
  reviewedOffer: ReviewedChangeOffer,
) {
  return (
    reviewedOffer.name === service.name &&
    reviewedOffer.priceUsd === fixedBookingPrice(service.priceUsd) &&
    reviewedOffer.durationMinutes === String(service.durationMinutes)
  );
}
