import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shops } from "@/db/schema/shops";
import { user } from "@/db/schema/auth";
import type { OwnerContext } from "@/server/owner-context";
import { getOwnSchedules } from "@/features/availability/queries";
import { hasUsableRecurringHours } from "@/features/availability/publication-readiness";

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

export type PublicationReadiness = { ready: boolean; missing: string[] };

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
): Promise<PublicationReadiness | null> {
  const shop = await getOwnShop(context);
  if (!shop) return null;
  const availability = await getOwnSchedules(context);
  if (!availability) return null;

  const missing: string[] = [];
  if (
    ![shop.name, shop.publicContact, shop.address].every((value) =>
      value.trim(),
    )
  )
    missing.push("shop details");
  if (!availability.services.length) missing.push("an offered service");
  const eligible = availability.services.flatMap((service) =>
    service.barberIds
      .map((id) => availability.barbers.find((barber) => barber.id === id))
      .filter((barber): barber is (typeof availability.barbers)[number] =>
        Boolean(barber && !barber.archived),
      )
      .map((barber) => ({ service, barber })),
  );
  if (!eligible.length) missing.push("an active barber assigned to a service");
  if (
    !eligible.some(({ service, barber }) =>
      hasUsableRecurringHours({
        durationMinutes: service.durationMinutes,
        shopWeek: availability.shop.week,
        barberWeek: barber.schedule.week,
      }),
    )
  )
    missing.push("shared recurring hours with a complete 15-minute-grid start");
  return { ready: missing.length === 0, missing };
}
