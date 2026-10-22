import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { barberServices, barbers, services } from "@/db/schema/catalog";
import type { ActionResult } from "@/lib/action-result";
import type { OwnerContext } from "@/server/owner-context";
import { saveBarberSchema } from "./schemas";
import type { BarberView } from "@/features/catalog/types";

function validationError(error: z.ZodError) {
  return {
    success: false as const,
    error: {
      code: "VALIDATION_ERROR",
      message: "Check the highlighted fields.",
    },
    fieldErrors: error.flatten().fieldErrors,
  };
}

export async function saveBarber(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<BarberView>> {
  if (!context)
    return {
      success: false,
      error: { code: "UNAUTHENTICATED", message: "Sign in to manage barbers." },
    };
  const parsed = saveBarberSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    return await db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id FROM shops WHERE owner_id = ${context.userId} FOR UPDATE`,
      );
      const shopId = locked.rows[0]?.id as string | undefined;
      if (!shopId)
        return {
          success: false as const,
          error: { code: "SHOP_REQUIRED", message: "Set up your shop first." },
        };
      if (parsed.data.serviceIds.length) {
        const found = await tx
          .select({ id: services.id })
          .from(services)
          .where(
            and(
              eq(services.shopId, shopId),
              inArray(services.id, parsed.data.serviceIds),
              eq(services.archived, false),
            ),
          );
        if (found.length !== parsed.data.serviceIds.length)
          return {
            success: false as const,
            error: {
              code: "INVALID_ASSIGNMENT",
              message: "Choose active services from your shop.",
            },
          };
      }
      const id = parsed.data.id ?? randomUUID();
      if (parsed.data.id) {
        const [existing] = await tx
          .select()
          .from(barbers)
          .where(sql`${barbers.id} = ${id} AND ${barbers.shopId} = ${shopId}`)
          .limit(1);
        if (!existing)
          return {
            success: false as const,
            error: { code: "NOT_FOUND", message: "Barber not found." },
          };
        if (existing.archived)
          return {
            success: false as const,
            error: {
              code: "RESOURCE_ARCHIVED",
              message: "Archived barbers cannot be changed.",
            },
          };
      }
      const [barber] = await tx
        .insert(barbers)
        .values({ id, shopId, name: parsed.data.name })
        .onConflictDoUpdate({
          target: barbers.id,
          set: { name: parsed.data.name },
        })
        .returning();
      await tx.execute(
        sql`DELETE FROM barber_services links USING services counterpart WHERE links.shop_id = ${shopId} AND links.barber_id = ${id} AND links.service_id = counterpart.id AND counterpart.archived = false`,
      );
      if (parsed.data.serviceIds.length)
        await tx.insert(barberServices).values(
          parsed.data.serviceIds.map((serviceId) => ({
            shopId,
            barberId: id,
            serviceId,
          })),
        );
      return {
        success: true as const,
        data: {
          id,
          name: barber.name,
          archived: barber.archived,
          serviceIds: parsed.data.serviceIds,
        },
      };
    });
  } catch {
    return {
      success: false,
      error: { code: "SAVE_FAILED", message: "Unable to save your barber." },
    };
  }
}

export async function archiveBarber(
  context: OwnerContext | null,
  id: string,
): Promise<ActionResult<BarberView>> {
  if (!context)
    return {
      success: false,
      error: { code: "UNAUTHENTICATED", message: "Sign in to manage barbers." },
    };
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return {
      success: false,
      error: { code: "NOT_FOUND", message: "Barber not found." },
    };
  try {
    return await db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id FROM shops WHERE owner_id = ${context.userId} FOR UPDATE`,
      );
      const shopId = locked.rows[0]?.id as string | undefined;
      if (!shopId)
        return {
          success: false as const,
          error: { code: "SHOP_REQUIRED", message: "Set up your shop first." },
        };
      const [barber] = await tx
        .update(barbers)
        .set({ archived: true })
        .where(sql`${barbers.id} = ${id} AND ${barbers.shopId} = ${shopId}`)
        .returning();
      if (!barber)
        return {
          success: false as const,
          error: { code: "NOT_FOUND", message: "Barber not found." },
        };
      const assignments = await tx
        .select({ serviceId: barberServices.serviceId })
        .from(barberServices)
        .where(
          sql`${barberServices.shopId} = ${shopId} AND ${barberServices.barberId} = ${id}`,
        );
      return {
        success: true as const,
        data: {
          id,
          name: barber.name,
          archived: true,
          serviceIds: assignments.map(({ serviceId }) => serviceId),
        },
      };
    });
  } catch {
    return {
      success: false,
      error: { code: "SAVE_FAILED", message: "Unable to archive your barber." },
    };
  }
}
