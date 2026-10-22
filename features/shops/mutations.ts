import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { shops } from "@/db/schema/shops";
import type { ActionResult } from "@/lib/action-result";
import type { OwnerContext } from "@/server/owner-context";
import type { ShopView } from "./queries";
import { createShopSchema, subdomainAvailabilitySchema, updateShopSchema } from "./schemas";

function validationError(error: z.ZodError) {
  return {
    success: false as const,
    error: { code: "VALIDATION_ERROR", message: "Check the highlighted fields." },
    fieldErrors: error?.flatten().fieldErrors,
  };
}

export async function checkSubdomainAvailability(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<{ available: boolean }>> {
  if (!context) {
    return {
      success: false,
      error: { code: "UNAUTHENTICATED", message: "Sign in to check a subdomain." },
    };
  }
  const parsed = subdomainAvailabilitySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const [shop] = await db.select({ id: shops.id }).from(shops)
      .where(eq(shops.subdomain, parsed.data.subdomain)).limit(1);
    return { success: true, data: { available: !shop } };
  } catch {
    return {
      success: false,
      error: { code: "SAVE_FAILED", message: "Unable to check that subdomain. Try again." },
    };
  }
}

export async function createShop(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<ShopView>> {
  if (!context) {
    return {
      success: false,
      error: { code: "UNAUTHENTICATED", message: "Sign in to create a shop." },
    };
  }

  const parsed = createShopSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const [shop] = await db
      .insert(shops)
      .values({ id: randomUUID(), ownerId: context.userId, ...parsed.data })
      .returning();

    return {
      success: true,
      data: {
        id: shop.id,
        name: shop.name,
        subdomain: shop.subdomain,
        timeZone: shop.timeZone,
        publicContact: shop.publicContact,
        address: shop.address,
        published: shop.published,
      },
    };
  } catch (error) {
    const databaseError =
      error instanceof Error && error.cause && typeof error.cause === "object"
        ? error.cause
        : error;
    const code =
      typeof databaseError === "object" && databaseError && "code" in databaseError
        ? databaseError.code
        : undefined;
    const constraint =
      typeof databaseError === "object" && databaseError && "constraint" in databaseError
        ? databaseError.constraint
        : undefined;
    if (code === "23505") {
      return {
        success: false,
        error:
          constraint === "shops_owner_id_key"
            ? { code: "SHOP_EXISTS", message: "You already have a shop." }
            : { code: "SUBDOMAIN_UNAVAILABLE", message: "That subdomain is unavailable." },
      };
    }
    return {
      success: false,
      error: { code: "SAVE_FAILED", message: "Unable to save your shop." },
    };
  }
}

export async function updateOwnShop(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<ShopView>> {
  if (!context) {
    return {
      success: false,
      error: { code: "UNAUTHENTICATED", message: "Sign in to update your shop." },
    };
  }

  const parsed = updateShopSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  try {
    return await db.transaction(async (transaction) => {
      const locked = await transaction.execute(
        sql`SELECT id, time_zone, time_zone_locked_at FROM shops WHERE owner_id = ${context.userId} FOR UPDATE`,
      );
      const shop = locked.rows[0] as
        | { id: string; time_zone: string; time_zone_locked_at: Date | null }
        | undefined;
      if (!shop) {
        return {
          success: false as const,
          error: { code: "SAVE_FAILED", message: "Unable to save your settings." },
        };
      }
      if (shop.time_zone_locked_at && shop.time_zone !== parsed.data.timeZone) {
        return {
          success: false as const,
          error: {
            code: "TIME_ZONE_LOCKED",
            message: "Your shop time zone is locked after its first appointment.",
          },
        };
      }

      const [updated] = await transaction
        .update(shops)
        .set(parsed.data)
        .where(eq(shops.id, shop.id))
        .returning();
      return {
        success: true as const,
        data: {
          id: updated.id,
          name: updated.name,
          subdomain: updated.subdomain,
          timeZone: updated.timeZone,
          publicContact: updated.publicContact,
          address: updated.address,
          published: updated.published,
        },
      };
    });
  } catch {
    return {
      success: false,
      error: { code: "SAVE_FAILED", message: "Unable to save your settings." },
    };
  }
}
