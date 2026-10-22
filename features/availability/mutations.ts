import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { barbers } from "@/db/schema/catalog";
import { barberSchedules, shopSchedules } from "@/db/schema/availability";
import type { ActionResult } from "@/lib/action-result";
import type { OwnerContext } from "@/server/owner-context";
import type { ScheduleView, WeeklySchedule } from "./types";
import { saveBarberScheduleSchema, saveShopScheduleSchema } from "./schemas";

function validationError(error: z.ZodError): ActionResult<ScheduleView> {
  return {
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "Check the highlighted schedule ranges.",
    },
    fieldErrors: error.issues.reduce<Record<string, string[]>>(
      (errors, issue) => {
        const path = issue.path.join(".");
        if (path) (errors[path] ??= []).push(issue.message);
        return errors;
      },
      {},
    ),
  };
}

function denied(): ActionResult<ScheduleView> {
  return {
    success: false,
    error: {
      code: "UNAUTHENTICATED",
      message: "Sign in to manage availability.",
    },
  };
}

export async function saveShopSchedule(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<ScheduleView>> {
  if (!context) return denied();
  const parsed = saveShopScheduleSchema.safeParse(input);
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
          error: {
            code: "SHOP_REQUIRED",
            message: "Set up your shop before adding hours.",
          },
        };
      const [existing] = await tx
        .select()
        .from(shopSchedules)
        .where(eq(shopSchedules.shopId, shopId))
        .limit(1);
      const revision = existing?.revision ?? 0;
      if (parsed.data.revision !== revision)
        return {
          success: false as const,
          error: {
            code: "STALE_SCHEDULE",
            message:
              "Shop hours changed in another session. Reload before saving.",
          },
        };
      const next = revision + 1;
      await tx
        .insert(shopSchedules)
        .values({ shopId, week: parsed.data.week, revision: next })
        .onConflictDoUpdate({
          target: shopSchedules.shopId,
          set: { week: parsed.data.week, revision: next },
        });
      if (!existing) {
        await tx.execute(
          sql`INSERT INTO barber_schedules (shop_id, barber_id, week, revision) SELECT ${shopId}, id, ${JSON.stringify(parsed.data.week)}::jsonb, 1 FROM barbers WHERE shop_id = ${shopId} AND archived = false ON CONFLICT (shop_id, barber_id) DO NOTHING`,
        );
      }
      return {
        success: true as const,
        data: { week: parsed.data.week, revision: next },
      };
    });
  } catch {
    return {
      success: false,
      error: { code: "SAVE_FAILED", message: "Unable to save shop hours." },
    };
  }
}

export async function saveBarberSchedule(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<ScheduleView>> {
  if (!context) return denied();
  const parsed = saveBarberScheduleSchema.safeParse(input);
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
          error: {
            code: "SHOP_REQUIRED",
            message: "Set up your shop before adding barber hours.",
          },
        };
      const [shopSchedule] = await tx
        .select({ shopId: shopSchedules.shopId })
        .from(shopSchedules)
        .where(eq(shopSchedules.shopId, shopId))
        .limit(1);
      if (!shopSchedule)
        return {
          success: false as const,
          error: {
            code: "SHOP_SCHEDULE_REQUIRED",
            message: "Save shop hours before configuring barber hours.",
          },
        };
      const [barber] = await tx
        .select({ id: barbers.id })
        .from(barbers)
        .where(
          and(
            eq(barbers.id, parsed.data.barberId),
            eq(barbers.shopId, shopId),
            eq(barbers.archived, false),
          ),
        )
        .limit(1);
      if (!barber)
        return {
          success: false as const,
          error: { code: "NOT_FOUND", message: "Active barber not found." },
        };
      const [existing] = await tx
        .select()
        .from(barberSchedules)
        .where(
          and(
            eq(barberSchedules.shopId, shopId),
            eq(barberSchedules.barberId, barber.id),
          ),
        )
        .limit(1);
      const revision = existing?.revision ?? 0;
      if (parsed.data.revision !== revision)
        return {
          success: false as const,
          error: {
            code: "STALE_SCHEDULE",
            message:
              "Barber hours changed in another session. Reload before saving.",
          },
        };
      const next = revision + 1;
      await tx
        .insert(barberSchedules)
        .values({
          shopId,
          barberId: barber.id,
          week: parsed.data.week,
          revision: next,
        })
        .onConflictDoUpdate({
          target: [barberSchedules.shopId, barberSchedules.barberId],
          set: { week: parsed.data.week, revision: next },
        });
      return {
        success: true as const,
        data: { week: parsed.data.week, revision: next },
      };
    });
  } catch {
    return {
      success: false,
      error: { code: "SAVE_FAILED", message: "Unable to save barber hours." },
    };
  }
}

export type { WeeklySchedule };
