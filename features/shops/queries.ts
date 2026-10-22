import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shops } from "@/db/schema/shops";
import type { OwnerContext } from "@/server/owner-context";

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
