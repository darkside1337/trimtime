import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { occupiedIntervals, timeBlocks } from "@/db/schema/occupancy";
import { findBookingConflictsInInterval } from "@/features/bookings/protection";
import type { ActionResult } from "@/lib/action-result";
import type { OwnerContext } from "@/server/owner-context";
import type { TimeBlockView } from "../types";
import { createTimeBlockSchema, removeTimeBlockSchema } from "../schemas";
import {
  blockValidationError,
  denied,
  findActiveBarber,
  lockOwnerShop,
} from "./primitives";

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
      const barber = await findActiveBarber(tx, shopId, parsed.data.barberId);
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
