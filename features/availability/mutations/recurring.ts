import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { barberSchedules, shopSchedules } from "@/db/schema/availability";
import {
  BookingProtectionError,
  assertBookingsFitCurrentSchedules,
} from "@/features/bookings/protection";
import type { ActionResult } from "@/lib/action-result";
import type { OwnerContext } from "@/server/owner-context";
import type { ScheduleView } from "../types";
import { saveBarberScheduleSchema, saveShopScheduleSchema } from "../schemas";
import {
  denied,
  findActiveBarber,
  lockOwnerShop,
  validationError,
} from "./primitives";

export async function saveShopSchedule(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<ScheduleView>> {
  if (!context) return denied<ScheduleView>();
  const parsed = saveShopScheduleSchema.safeParse(input);
  if (!parsed.success)
    return validationError<ScheduleView>(
      parsed.error,
      "Check the highlighted schedule ranges.",
    );
  try {
    return await db.transaction(async (tx) => {
      const shop = await lockOwnerShop(tx, context.userId);
      if (!shop)
        return {
          success: false as const,
          error: {
            code: "SHOP_REQUIRED",
            message: "Set up your shop before adding hours.",
          },
        };
      const shopId = shop.id;
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
      await assertBookingsFitCurrentSchedules(tx, shopId);
      return {
        success: true as const,
        data: { week: parsed.data.week, revision: next },
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
      error: { code: "SAVE_FAILED", message: "Unable to save shop hours." },
    };
  }
}

export async function saveBarberSchedule(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<ScheduleView>> {
  if (!context) return denied<ScheduleView>();
  const parsed = saveBarberScheduleSchema.safeParse(input);
  if (!parsed.success)
    return validationError<ScheduleView>(
      parsed.error,
      "Check the highlighted schedule ranges.",
    );
  try {
    return await db.transaction(async (tx) => {
      const shop = await lockOwnerShop(tx, context.userId);
      if (!shop)
        return {
          success: false as const,
          error: {
            code: "SHOP_REQUIRED",
            message: "Set up your shop before adding barber hours.",
          },
        };
      const shopId = shop.id;
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
      const barber = await findActiveBarber(tx, shopId, parsed.data.barberId);
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
      await assertBookingsFitCurrentSchedules(tx, shopId);
      return {
        success: true as const,
        data: { week: parsed.data.week, revision: next },
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
      error: { code: "SAVE_FAILED", message: "Unable to save barber hours." },
    };
  }
}
