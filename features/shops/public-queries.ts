import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { barberServices, barbers, services } from "@/db/schema/catalog";
import { shops } from "@/db/schema/shops";
import { classifyHost, shopLabelForHost } from "@/server/hosts";
import { previewPublishedShopSlots } from "@/features/availability/queries";

export type PublicShopView =
  | { status: "paused"; name: string; publicContact: string; timeZone: string }
  | {
      status: "published";
      name: string;
      address: string;
      publicContact: string;
      timeZone: string;
      services: {
        id: string;
        name: string;
        priceUsd: string;
        durationMinutes: string;
        barbers: { id: string; name: string }[];
      }[];
    };

export async function publicShopExists(subdomain: string) {
  const [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.subdomain, subdomain))
    .limit(1);
  return Boolean(shop);
}

export async function getPublicShop(
  requestHeaders: Headers,
): Promise<PublicShopView | null> {
  if (classifyHost(requestHeaders) !== "shop") return null;
  const subdomain = shopLabelForHost(requestHeaders);
  if (!subdomain) return null;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
    );
    const [shop] = await tx
      .select({
        id: shops.id,
        name: shops.name,
        address: shops.address,
        publicContact: shops.publicContact,
        timeZone: shops.timeZone,
        published: shops.published,
      })
      .from(shops)
      .where(eq(shops.subdomain, subdomain))
      .limit(1);
    if (!shop) return null;
    if (!shop.published)
      return {
        status: "paused",
        name: shop.name,
        publicContact: shop.publicContact,
        timeZone: shop.timeZone,
      };
    const rows = await tx
      .select({
        id: services.id,
        name: services.name,
        priceUsd: services.priceUsd,
        durationMinutes: services.durationMinutes,
        barberId: barbers.id,
        barberName: barbers.name,
      })
      .from(services)
      .innerJoin(
        barberServices,
        and(
          eq(barberServices.shopId, services.shopId),
          eq(barberServices.serviceId, services.id),
        ),
      )
      .innerJoin(
        barbers,
        and(
          eq(barbers.shopId, barberServices.shopId),
          eq(barbers.id, barberServices.barberId),
          eq(barbers.archived, false),
        ),
      )
      .where(
        and(
          eq(services.shopId, shop.id),
          eq(services.offered, true),
          eq(services.archived, false),
        ),
      );
    const grouped = new Map<
      string,
      {
        id: string;
        name: string;
        priceUsd: string;
        durationMinutes: string;
        barbers: { id: string; name: string }[];
      }
    >();
    for (const row of rows) {
      const item = grouped.get(row.id) ?? {
        id: row.id,
        name: row.name,
        priceUsd: row.priceUsd,
        durationMinutes: row.durationMinutes,
        barbers: [],
      };
      if (row.barberId && row.barberName)
        item.barbers.push({ id: row.barberId, name: row.barberName });
      grouped.set(row.id, item);
    }
    return {
      status: "published",
      name: shop.name,
      address: shop.address,
      publicContact: shop.publicContact,
      timeZone: shop.timeZone,
      services: [...grouped.values()],
    };
  });
}

export async function previewPublicSlots(
  requestHeaders: Headers,
  input: unknown,
) {
  if (classifyHost(requestHeaders) !== "shop") return null;
  const subdomain = shopLabelForHost(requestHeaders);
  if (!subdomain) return null;
  const [shop] = await db
    .select({ id: shops.id, published: shops.published })
    .from(shops)
    .where(eq(shops.subdomain, subdomain))
    .limit(1);
  if (!shop?.published) return null;
  return previewPublishedShopSlots(shop.id, input);
}
