import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { barberServices, services } from "@/db/schema/catalog";
import { barbers } from "@/db/schema/catalog";
import { shops } from "@/db/schema/shops";
import type { OwnerContext } from "@/server/owner-context";
import { OwnerUnauthorizedError } from "@/features/shops/queries";
import type { ServiceView } from "./types";

export async function getOwnServices(
  context: OwnerContext | null,
): Promise<ServiceView[] | null> {
  if (!context) throw new OwnerUnauthorizedError();
  const [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.ownerId, context.userId))
    .limit(1);
  if (!shop) return null;
  const rows = await db
    .select({
      id: services.id,
      name: services.name,
      priceUsd: services.priceUsd,
      durationMinutes: services.durationMinutes,
      offered: services.offered,
      archived: services.archived,
      barberId: barbers.id,
    })
    .from(services)
    .leftJoin(barberServices, eq(barberServices.serviceId, services.id))
    .leftJoin(
      barbers,
      and(eq(barbers.id, barberServices.barberId), eq(barbers.archived, false)),
    )
    .where(eq(services.shopId, shop.id));
  const grouped = new Map<string, ServiceView>();
  for (const row of rows) {
    const current = grouped.get(row.id) ?? {
      id: row.id,
      name: row.name,
      priceUsd: row.priceUsd,
      durationMinutes: row.durationMinutes,
      offered: row.offered,
      archived: row.archived,
      barberIds: [],
    };
    if (row.barberId) current.barberIds.push(row.barberId);
    grouped.set(row.id, current);
  }
  return [...grouped.values()];
}

export async function getOwnOfferingChoices(
  context: OwnerContext | null,
): Promise<ServiceView[] | null> {
  const all = await getOwnServices(context);
  if (!all) return null;
  const eligible = new Set(
    (
      await db
        .selectDistinct({ serviceId: barberServices.serviceId })
        .from(barberServices)
        .innerJoin(services, eq(barberServices.serviceId, services.id))
        .innerJoin(barbers, eq(barberServices.barberId, barbers.id))
        .where(
          and(
            eq(services.offered, true),
            eq(services.archived, false),
            eq(barbers.archived, false),
          ),
        )
    ).map(({ serviceId }) => serviceId),
  );
  return all.filter(
    (service) =>
      !service.archived && service.offered && eligible.has(service.id),
  );
}
