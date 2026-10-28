import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { z } from "zod";
import { db } from "@/db";
import { barbers } from "@/db/schema/catalog";
import {
  barberDateSchedules,
  barberSchedules,
  shopDateSchedules,
  shopSchedules,
} from "@/db/schema/availability";
import { occupiedIntervals, timeBlocks } from "@/db/schema/occupancy";
import {
  BookingProtectionError,
  assertBookingsFitCurrentSchedules,
  findBookingConflictsInInterval,
} from "@/features/bookings/protection";
import type { ActionResult } from "@/lib/action-result";
import type { OwnerContext } from "@/server/owner-context";
import type {
  DateScheduleView,
  ScheduleView,
  TimeBlockView,
  WeeklySchedule,
} from "./types";
import {
  createTimeBlockSchema,
  removeTimeBlockSchema,
  saveBarberDateScheduleSchema,
  saveBarberScheduleSchema,
  saveShopDateScheduleSchema,
  saveShopScheduleSchema,
} from "./schemas";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type LockedShop = { id: string; timeZone: string };

async function lockOwnerShop(
  tx: Transaction,
  userId: string,
): Promise<LockedShop | undefined> {
  const locked = await tx.execute(
    sql`SELECT id, time_zone FROM shops WHERE owner_id = ${userId} FOR UPDATE`,
  );
  const row = locked.rows[0] as { id: string; time_zone: string } | undefined;
  return row ? { id: row.id, timeZone: row.time_zone } : undefined;
}

function validationError<T>(
  error: z.ZodError,
  message: string,
): ActionResult<T> {
  return {
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message,
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

function blockValidationError(error: z.ZodError): ActionResult<TimeBlockView> {
  return {
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "Check the block date and times.",
    },
    fieldErrors: error.flatten().fieldErrors,
  };
}

function denied<T>(): ActionResult<T> {
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
        const [barber] = await tx
          .select({ id: barbers.id })
          .from(barbers)
          .where(
            and(
              eq(barbers.id, barberId),
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

export async function createTimeBlock(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<TimeBlockView>> {
  if (!context) return denied<TimeBlockView>();
  const parsed = createTimeBlockSchema.safeParse(input);
  if (!parsed.success) return blockValidationError(parsed.error);
  try {
    const start = Temporal.Instant.from(parsed.data.start);
    const end = Temporal.Instant.from(parsed.data.end);
    return await db.transaction(async (tx) => {
      const shop = await lockOwnerShop(tx, context.userId);
      if (!shop)
        return {
          success: false as const,
          error: { code: "SHOP_REQUIRED", message: "Set up your shop first." },
        };
      const shopId = shop.id;
      const now = new Date();
      const timeZone = shop.timeZone;
      if (timeZone !== parsed.data.timeZone)
        return {
          success: false as const,
          error: {
            code: "STALE_TIME_ZONE",
            message:
              "The shop time zone changed. Reload before adding a block.",
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
      const bookingConflict = await findBookingConflictsInInterval(tx, {
        shopId,
        barberId: barber.id,
        startAt: new Date(start.epochMilliseconds),
        endAt: new Date(end.epochMilliseconds),
        now,
      });
      if (bookingConflict.length)
        return {
          success: false as const,
          error: {
            code: "BOOKING_CONFLICT",
            message: "This block conflicts with a confirmed booking.",
            bookingConflicts: bookingConflict,
          },
        };
      const date = Temporal.PlainDate.from(parsed.data.date);
      const startLocal = start.toZonedDateTimeISO(timeZone);
      const endLocal = end.toZonedDateTimeISO(timeZone);
      const nextMidnight = date
        .add({ days: 1 })
        .toZonedDateTime({ timeZone })
        .toInstant();
      if (
        Temporal.PlainDate.compare(startLocal.toPlainDate(), date) !== 0 ||
        Temporal.Instant.compare(end, nextMidnight) > 0 ||
        (Temporal.PlainDate.compare(
          endLocal.toPlainDate(),
          date.add({ days: 1 }),
        ) === 0 &&
          (endLocal.hour !== 0 || endLocal.minute !== 0))
      )
        return {
          success: false as const,
          error: {
            code: "VALIDATION_ERROR",
            message: "A block must fit within one shop-local date.",
          },
        };
      const id = randomUUID();
      await tx.insert(occupiedIntervals).values({
        id,
        shopId,
        barberId: barber.id,
        startAt: new Date(start.epochMilliseconds),
        endAt: new Date(end.epochMilliseconds),
      });
      await tx.insert(timeBlocks).values({ id, note: parsed.data.note });
      return {
        success: true as const,
        data: {
          id,
          barberId: barber.id,
          start: start.toString(),
          end: end.toString(),
          note: parsed.data.note,
        },
      };
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (("code" in error && error.code === "23P01") ||
        ("cause" in error &&
          typeof error.cause === "object" &&
          error.cause !== null &&
          "code" in error.cause &&
          error.cause.code === "23P01"))
    )
      return {
        success: false,
        error: {
          code: "BLOCK_CONFLICT",
          message: "This barber already has a block during that time.",
        },
      };
    return {
      success: false,
      error: { code: "SAVE_FAILED", message: "Unable to save the time block." },
    };
  }
}

export async function removeTimeBlock(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  if (!context) return denied<{ id: string }>();
  const parsed = removeTimeBlockSchema.safeParse(input);
  if (!parsed.success)
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Choose a valid time block.",
      },
    };
  try {
    return await db.transaction(async (tx) => {
      const shop = await lockOwnerShop(tx, context.userId);
      if (!shop)
        return {
          success: false as const,
          error: { code: "SHOP_REQUIRED", message: "Set up your shop first." },
        };
      const shopId = shop.id;
      const deleted = await tx
        .delete(occupiedIntervals)
        .where(
          and(
            eq(occupiedIntervals.id, parsed.data.id),
            eq(occupiedIntervals.shopId, shopId),
          ),
        )
        .returning({ id: occupiedIntervals.id });
      return deleted[0]
        ? { success: true as const, data: { id: deleted[0].id } }
        : {
            success: false as const,
            error: { code: "NOT_FOUND", message: "Time block not found." },
          };
    });
  } catch {
    return {
      success: false,
      error: {
        code: "SAVE_FAILED",
        message: "Unable to remove the time block.",
      },
    };
  }
}

export type { WeeklySchedule };
