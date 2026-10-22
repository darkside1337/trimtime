import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { barberServices, barbers, services } from "@/db/schema/catalog";
import { shops } from "@/db/schema/shops";
import { OwnerUnauthorizedError } from "@/features/shops/queries";
import type { BarberView } from "@/features/catalog/types";
import type { OwnerContext } from "@/server/owner-context";

export async function getOwnBarbers(
  context: OwnerContext | null,
): Promise<BarberView[] | null> {
  if (!context) throw new OwnerUnauthorizedError();
  const [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.ownerId, context.userId))
    .limit(1);
  if (!shop) return null;
  const rows = await db
    .select({
      id: barbers.id,
      name: barbers.name,
      archived: barbers.archived,
      serviceId: services.id,
    })
    .from(barbers)
    .leftJoin(barberServices, eq(barberServices.barberId, barbers.id))
    .leftJoin(
      services,
      and(
        eq(services.id, barberServices.serviceId),
        eq(services.archived, false),
      ),
    )
    .where(eq(barbers.shopId, shop.id));
  const grouped = new Map<string, BarberView>();
  for (const row of rows) {
    const current = grouped.get(row.id) ?? {
      id: row.id,
      name: row.name,
      archived: row.archived,
      serviceIds: [],
    };
    if (row.serviceId) current.serviceIds.push(row.serviceId);
    grouped.set(row.id, current);
  }
  return [...grouped.values()];
}
