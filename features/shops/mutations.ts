import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { shops } from "@/db/schema/shops";
import { barberServices, barbers, services } from "@/db/schema/catalog";
import { barberSchedules, shopSchedules } from "@/db/schema/availability";
import type { ActionResult } from "@/lib/action-result";
import type { OwnerContext } from "@/server/owner-context";
import { hasUsableRecurringHours } from "@/features/availability/publication-readiness";
import type { ShopView } from "./queries";
import {
  createShopSchema,
  shopPublicationSchema,
  subdomainAvailabilitySchema,
  updateShopSchema,
} from "./schemas";

function validationError(error: z.ZodError) {
  return {
    success: false as const,
    error: {
      code: "VALIDATION_ERROR",
      message: "Check the highlighted fields.",
    },
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
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in to check a subdomain.",
      },
    };
  }
  const parsed = subdomainAvailabilitySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const [shop] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.subdomain, parsed.data.subdomain))
      .limit(1);
    return { success: true, data: { available: !shop } };
  } catch {
    return {
      success: false,
      error: {
        code: "SAVE_FAILED",
        message: "Unable to check that subdomain. Try again.",
      },
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
      typeof databaseError === "object" &&
      databaseError &&
      "code" in databaseError
        ? databaseError.code
        : undefined;
    const constraint =
      typeof databaseError === "object" &&
      databaseError &&
      "constraint" in databaseError
        ? databaseError.constraint
        : undefined;
    if (code === "23505") {
      return {
        success: false,
        error:
          constraint === "shops_owner_id_key"
            ? { code: "SHOP_EXISTS", message: "You already have a shop." }
            : {
                code: "SUBDOMAIN_UNAVAILABLE",
                message: "That subdomain is unavailable.",
              },
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
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in to update your shop.",
      },
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
          error: {
            code: "SAVE_FAILED",
            message: "Unable to save your settings.",
          },
        };
      }
      if (shop.time_zone_locked_at && shop.time_zone !== parsed.data.timeZone) {
        return {
          success: false as const,
          error: {
            code: "TIME_ZONE_LOCKED",
            message:
              "Your shop time zone is locked after its first appointment.",
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

export async function setOwnShopPublication(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<ShopView>> {
  if (!context)
    return {
      success: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in to update publication.",
      },
    };
  const parsed = shopPublicationSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  try {
    return await db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT id, name, subdomain, time_zone, public_contact, address, published
        FROM shops WHERE owner_id = ${context.userId} FOR UPDATE
      `);
      const shop = locked.rows[0] as
        | {
            id: string;
            name: string;
            subdomain: string;
            time_zone: string;
            public_contact: string;
            address: string;
            published: boolean;
          }
        | undefined;
      if (!shop)
        return {
          success: false as const,
          error: { code: "SHOP_REQUIRED", message: "Set up your shop first." },
        };
      if (shop.published === parsed.data.published)
        return {
          success: true as const,
          data: {
            id: shop.id,
            name: shop.name,
            subdomain: shop.subdomain,
            timeZone: shop.time_zone,
            publicContact: shop.public_contact,
            address: shop.address,
            published: shop.published,
          },
        };
      if (shop.published !== parsed.data.expectedPublished)
        return {
          success: false as const,
          error: {
            code: "STALE_PUBLICATION",
            message:
              "Publication changed in another tab. Refresh to see the current status.",
          },
        };

      if (parsed.data.published) {
        const missing: string[] = [];
        if (
          ![shop.name, shop.public_contact, shop.address].every((value) =>
            value.trim(),
          )
        )
          missing.push("shop details");
        const offered = await tx
          .select({ id: services.id })
          .from(services)
          .where(
            and(
              eq(services.shopId, shop.id),
              eq(services.offered, true),
              eq(services.archived, false),
            ),
          );
        if (!offered.length) missing.push("an offered service");
        const eligible = await tx
          .select({
            durationMinutes: services.durationMinutes,
            barberWeek: barberSchedules.week,
            shopWeek: shopSchedules.week,
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
            ),
          )
          .leftJoin(shopSchedules, eq(shopSchedules.shopId, services.shopId))
          .leftJoin(
            barberSchedules,
            and(
              eq(barberSchedules.shopId, barbers.shopId),
              eq(barberSchedules.barberId, barbers.id),
            ),
          )
          .where(
            and(
              eq(services.shopId, shop.id),
              eq(services.offered, true),
              eq(services.archived, false),
              eq(barbers.archived, false),
            ),
          );
        if (!eligible.length)
          missing.push("an active barber assigned to a service");
        if (
          !eligible.some(
            (row) =>
              row.shopWeek &&
              row.barberWeek &&
              hasUsableRecurringHours({
                durationMinutes: row.durationMinutes,
                shopWeek: row.shopWeek,
                barberWeek: row.barberWeek,
              }),
          )
        )
          missing.push(
            "shared recurring hours with a complete 15-minute-grid start",
          );
        if (missing.length)
          return {
            success: false as const,
            error: {
              code: "NOT_READY",
              message: `Add ${missing.join(", ")} before publishing.`,
            },
          };
      }

      const [updated] = await tx
        .update(shops)
        .set({ published: parsed.data.published })
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
      error: {
        code: "SAVE_FAILED",
        message: "Unable to update publication. Try again.",
      },
    };
  }
}
