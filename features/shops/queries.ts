import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shops } from "@/db/schema/shops";
import { user } from "@/db/schema/auth";
import type { OwnerContext } from "@/server/owner-context";
import { getOwnSchedules } from "@/features/availability/queries";
import {
  evaluatePublicationReadiness,
  type PublicationReadiness as PublicationReadinessView,
} from "./publication-readiness";

export type { PublicationReadiness } from "./publication-readiness";

export type ShopView = {
  id: string;
  name: string;
  subdomain: string;
  timeZone: string;
  publicContact: string;
  address: string;
  published: boolean;
};

export class OwnerUnauthorizedError extends Error {
  constructor() {
    super("Sign in to access your shop.");
  }
}

export async function getOwnShop(
  context: OwnerContext | null,
): Promise<ShopView | null> {
  if (!context) throw new OwnerUnauthorizedError();
  const [shop] = await db
    .select()
    .from(shops)
    .where(eq(shops.ownerId, context.userId))
    .limit(1);
  if (!shop) return null;

  return {
    id: shop.id,
    name: shop.name,
    subdomain: shop.subdomain,
    timeZone: shop.timeZone,
    publicContact: shop.publicContact,
    address: shop.address,
    published: shop.published,
  };
}

export async function getOwnSettingsDetails(context: OwnerContext | null) {
  if (!context) throw new OwnerUnauthorizedError();
  const [details] = await db
    .select({
      name: user.name,
      email: user.email,
      timeZoneLockedAt: shops.timeZoneLockedAt,
    })
    .from(shops)
    .innerJoin(user, eq(user.id, shops.ownerId))
    .where(eq(shops.ownerId, context.userId))
    .limit(1);
  return details ?? null;
}

export async function getOwnPublicationReadiness(
  context: OwnerContext | null,
): Promise<PublicationReadinessView | null> {
  const shop = await getOwnShop(context);
  if (!shop) return null;
  const availability = await getOwnSchedules(context);
  if (!availability) return null;

  return evaluatePublicationReadiness({
    shop,
    shopWeek: availability.shop.week,
    services: availability.services,
    barbers: availability.barbers.map(({ id, archived, schedule }) => ({
      id,
      archived,
      week: schedule.week,
    })),
  });
}
