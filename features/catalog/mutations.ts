import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { z } from "zod";
import type { ZodError } from "zod";
import { barbers, barberServices, services } from "@/db/schema/catalog";
import type { ActionResult } from "@/lib/action-result";
import type { OwnerContext } from "@/server/owner-context";
import {
  BookingProtectionError,
  protectedBookingConflicts,
} from "@/features/bookings/protection";
import { saveServiceSchema } from "./schemas";
import type { ServiceInput, ServiceView } from "./types";

function validationError(error: ZodError) {
  return {
    success: false as const,
    error: {
      code: "VALIDATION_ERROR",
      message: "Check the highlighted fields.",
    },
    fieldErrors: error.flatten().fieldErrors,
  };
}

export async function saveService(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<ServiceView>> {
  if (!context)
    return {
      success: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in to manage services.",
      },
    };
  const parsed = saveServiceSchema.safeParse(input);
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
      const now = new Date();
      if (parsed.data.barberIds.length) {
        const found = await tx
          .select({ id: barbers.id })
          .from(barbers)
          .where(
            and(
              eq(barbers.shopId, shopId),
              inArray(barbers.id, parsed.data.barberIds),
              eq(barbers.archived, false),
            ),
          );
        if (found.length !== parsed.data.barberIds.length) {
          return {
            success: false as const,
            error: {
              code: "INVALID_ASSIGNMENT",
              message: "Choose active barbers from your shop.",
            },
          };
        }
      }
      const id = parsed.data.id ?? randomUUID();
      if (parsed.data.id) {
        const [existing] = await tx
          .select()
          .from(services)
          .where(sql`${services.id} = ${id} AND ${services.shopId} = ${shopId}`)
          .limit(1);
        if (!existing)
          return {
            success: false as const,
            error: { code: "NOT_FOUND", message: "Service not found." },
          };
        if (existing.archived)
          return {
            success: false as const,
            error: {
              code: "RESOURCE_ARCHIVED",
              message: "Archived services cannot be changed.",
            },
          };
        const assignments = await tx
          .select({ barberId: barberServices.barberId })
          .from(barberServices)
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
              eq(barberServices.shopId, shopId),
              eq(barberServices.serviceId, id),
            ),
          );
        const removed = assignments
          .map(({ barberId }) => barberId)
          .filter((barberId) => !parsed.data.barberIds.includes(barberId));
        const bookingConflicts = (
          await Promise.all(
            removed.map((barberId) =>
              protectedBookingConflicts(
                tx,
                {
                  shopId,
                  serviceId: id,
                  barberId,
                },
                now,
              ),
            ),
          )
        ).flat();
        if (bookingConflicts.length)
          throw new BookingProtectionError(bookingConflicts);
      }
      const [service] = await tx
        .insert(services)
        .values({
          id,
          shopId,
          name: parsed.data.name,
          priceUsd: parsed.data.priceUsd,
          durationMinutes: parsed.data.durationMinutes,
          offered: parsed.data.offered,
        })
        .onConflictDoUpdate({
          target: services.id,
          set: {
            name: parsed.data.name,
            priceUsd: parsed.data.priceUsd,
            durationMinutes: parsed.data.durationMinutes,
            offered: parsed.data.offered,
          },
        })
        .returning();
      await tx.execute(
        sql`DELETE FROM barber_services links USING barbers counterpart WHERE links.shop_id = ${shopId} AND links.service_id = ${id} AND links.barber_id = counterpart.id AND counterpart.archived = false`,
      );
      if (parsed.data.barberIds.length)
        await tx.insert(barberServices).values(
          parsed.data.barberIds.map((barberId) => ({
            shopId,
            barberId,
            serviceId: id,
          })),
        );
      return {
        success: true as const,
        data: { ...parsed.data, id: service.id, archived: service.archived },
      };
    });
  } catch (error) {
    if (error instanceof BookingProtectionError)
      return {
        success: false,
        error: {
          code: "BOOKING_CONFLICT",
          message: error.message,
          bookingConflicts: error.bookingConflicts,
        },
      };
    return {
      success: false,
      error: { code: "SAVE_FAILED", message: "Unable to save your service." },
    };
  }
}

export async function setServiceOffered(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<ServiceView>> {
  if (!context)
    return {
      success: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in to manage services.",
      },
    };
  const parsed = z
    .object({ id: z.string().uuid(), offered: z.boolean() })
    .strict()
    .safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return updateServiceState(context, parsed.data.id, {
    offered: parsed.data.offered,
  });
}

export async function archiveService(
  context: OwnerContext | null,
  id: string,
): Promise<ActionResult<ServiceView>> {
  if (!context)
    return {
      success: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in to manage services.",
      },
    };
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return {
      success: false,
      error: { code: "NOT_FOUND", message: "Service not found." },
    };
  return updateServiceState(context, id, { archived: true });
}

async function updateServiceState(
  context: OwnerContext,
  id: string,
  change: { offered?: boolean; archived?: boolean },
): Promise<ActionResult<ServiceView>> {
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
      const now = new Date();
      if (change.offered !== undefined) {
        const [current] = await tx
          .select({ archived: services.archived })
          .from(services)
          .where(sql`${services.id} = ${id} AND ${services.shopId} = ${shopId}`)
          .limit(1);
        if (!current)
          return {
            success: false as const,
            error: { code: "NOT_FOUND", message: "Service not found." },
          };
        if (current.archived)
          return {
            success: false as const,
            error: {
              code: "RESOURCE_ARCHIVED",
              message: "Archived services cannot be changed.",
            },
          };
      }
      if (change.archived) {
        const bookingConflicts = await protectedBookingConflicts(
          tx,
          {
            shopId,
            serviceId: id,
          },
          now,
        );
        if (bookingConflicts.length)
          throw new BookingProtectionError(bookingConflicts);
      }
      const [service] = await tx
        .update(services)
        .set(change)
        .where(sql`${services.id} = ${id} AND ${services.shopId} = ${shopId}`)
        .returning();
      if (!service)
        return {
          success: false as const,
          error: { code: "NOT_FOUND", message: "Service not found." },
        };
      const assignments = await tx
        .select({ barberId: barberServices.barberId })
        .from(barberServices)
        .innerJoin(barbers, eq(barberServices.barberId, barbers.id))
        .where(
          sql`${barberServices.shopId} = ${shopId} AND ${barberServices.serviceId} = ${id} AND ${barbers.archived} = false`,
        );
      return {
        success: true as const,
        data: {
          id,
          name: service.name,
          priceUsd: service.priceUsd,
          durationMinutes: service.durationMinutes,
          offered: service.offered,
          archived: service.archived,
          barberIds: assignments.map((assignment) => assignment.barberId),
        },
      };
    });
  } catch (error) {
    if (error instanceof BookingProtectionError)
      return {
        success: false,
        error: {
          code: "BOOKING_CONFLICT",
          message: error.message,
          bookingConflicts: error.bookingConflicts,
        },
      };
    return {
      success: false,
      error: { code: "SAVE_FAILED", message: "Unable to update your service." },
    };
  }
}

export type { ServiceInput };
