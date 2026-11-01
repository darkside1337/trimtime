import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  barberDateSchedules,
  shopDateSchedules,
} from "@/db/schema/availability";
import {
  BookingProtectionError,
  assertBookingsFitCurrentSchedules,
} from "@/features/bookings/protection";
import type { ActionResult } from "@/lib/action-result";
import type { OwnerContext } from "@/server/owner-context";
import type { DateScheduleView } from "../types";
import {
  saveBarberDateScheduleSchema,
  saveShopDateScheduleSchema,
} from "../schemas";
import {
  denied,
  findActiveBarber,
  lockOwnerShop,
  validationError,
} from "./primitives";

async function saveDateSchedule(
  context: OwnerContext | null,
  input: unknown,
  barberTarget: boolean,
): Promise<ActionResult<DateScheduleView>> {
  if (!context) return denied<DateScheduleView>();
  const schema = barberTarget
    ? saveBarberDateScheduleSchema
    : saveShopDateScheduleSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return validationError<DateScheduleView>(
      parsed.error,
      "Check the dated availability values.",
    );
  const data = parsed.data;
  try {
    return await db.transaction(async (tx) => {
      const shop = await lockOwnerShop(tx, context.userId);
      if (!shop)
        return {
          success: false as const,
          error: { code: "SHOP_REQUIRED", message: "Set up your shop first." },
        };
      if (shop.timeZone !== data.timeZone)
        return {
          success: false as const,
          error: {
            code: "STALE_TIME_ZONE",
            message: "The shop time zone changed. Reload before saving.",
          },
        };
      const shopId = shop.id;
      let revision = 0;
      if (barberTarget) {
        const barberId = (data as typeof data & { barberId: string }).barberId;
        const barber = await findActiveBarber(tx, shopId, barberId);
        if (!barber)
          return {
            success: false as const,
            error: { code: "NOT_FOUND", message: "Active barber not found." },
          };
        const [existing] = await tx
          .select()
          .from(barberDateSchedules)
          .where(
            and(
              eq(barberDateSchedules.shopId, shopId),
              eq(barberDateSchedules.barberId, barberId),
              eq(barberDateSchedules.date, data.date),
            ),
          )
          .limit(1);
        revision = existing?.revision ?? 0;
        if (revision !== data.revision)
          return {
            success: false as const,
            error: {
              code: "STALE_DATE_SCHEDULE",
              message:
                "Dated availability changed elsewhere. Reload before saving.",
            },
          };
        const next = revision + 1;
        await tx
          .insert(barberDateSchedules)
          .values({
            shopId,
            barberId,
            date: data.date,
            override: data.override,
            closed: data.closed,
            revision: next,
          })
          .onConflictDoUpdate({
            target: [
              barberDateSchedules.shopId,
              barberDateSchedules.barberId,
              barberDateSchedules.date,
            ],
            set: {
              override: data.override,
              closed: data.closed,
              revision: next,
            },
          });
        await assertBookingsFitCurrentSchedules(tx, shopId);
        return {
          success: true as const,
          data: {
            override: data.override,
            closed: data.closed,
            revision: next,
          },
        };
      }
      const [existing] = await tx
        .select()
        .from(shopDateSchedules)
        .where(
          and(
            eq(shopDateSchedules.shopId, shopId),
            eq(shopDateSchedules.date, data.date),
          ),
        )
        .limit(1);
      revision = existing?.revision ?? 0;
      if (revision !== data.revision)
        return {
          success: false as const,
          error: {
            code: "STALE_DATE_SCHEDULE",
            message:
              "Dated availability changed elsewhere. Reload before saving.",
          },
        };
      const next = revision + 1;
      await tx
        .insert(shopDateSchedules)
        .values({
          shopId,
          date: data.date,
          override: data.override,
          closed: data.closed,
          revision: next,
        })
        .onConflictDoUpdate({
          target: [shopDateSchedules.shopId, shopDateSchedules.date],
          set: { override: data.override, closed: data.closed, revision: next },
        });
      await assertBookingsFitCurrentSchedules(tx, shopId);
      return {
        success: true as const,
        data: { override: data.override, closed: data.closed, revision: next },
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
      error: {
        code: "SAVE_FAILED",
        message: "Unable to save dated availability.",
      },
    };
  }
}

export const saveShopDateSchedule = (
  context: OwnerContext | null,
  input: unknown,
) => saveDateSchedule(context, input, false);
export const saveBarberDateSchedule = (
  context: OwnerContext | null,
  input: unknown,
) => saveDateSchedule(context, input, true);
