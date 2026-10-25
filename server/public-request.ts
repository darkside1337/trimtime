import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shops } from "@/db/schema/shops";
import { classifyHost, shopLabelForHost } from "@/server/hosts";
import type { PublicBookingContext } from "@/features/bookings/types";

export async function resolvePublicRequest(
  headers: Headers,
): Promise<PublicBookingContext | null> {
  if (classifyHost(headers) !== "shop") return null;
  const subdomain = shopLabelForHost(headers);
  if (!subdomain) return null;
  const [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.subdomain, subdomain))
    .limit(1);
  if (!shop) return null;
  return { shopId: shop.id };
}
