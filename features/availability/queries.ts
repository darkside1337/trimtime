import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { barberServices, barbers, services } from "@/db/schema/catalog";
import { barberSchedules, shopSchedules } from "@/db/schema/availability";
import { shops } from "@/db/schema/shops";
import type { ActionResult } from "@/lib/action-result";
import type { OwnerContext } from "@/server/owner-context";
import { OwnerUnauthorizedError } from "@/features/shops/queries";
import { previewSlotsSchema, type PreviewSlotsInput } from "./schemas";
import { calculateSlots } from "./slots";
import type { DaySchedule, ScheduleView, WeeklySchedule } from "./types";

export type AvailabilityData = {
  timeZone: string;
  shop: ScheduleView;
  barbers: {
    id: string;
    name: string;
    archived: boolean;
    schedule: ScheduleView;
  }[];
  services: {
    id: string;
    name: string;
    durationMinutes: string;
    barberIds: string[];
  }[];
};

const emptyWeek = (): WeeklySchedule =>
  Array.from({ length: 7 }, () => ({ working: [], breaks: [] }));

export async function getOwnSchedules(
  context: OwnerContext | null,
): Promise<AvailabilityData | null> {
  if (!context) throw new OwnerUnauthorizedError();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
    );
    const [shop] = await tx
      .select({ id: shops.id, timeZone: shops.timeZone })
      .from(shops)
      .where(eq(shops.ownerId, context.userId))
      .limit(1);
    if (!shop) return null;
    const [shopSchedule] = await tx
      .select()
      .from(shopSchedules)
      .where(eq(shopSchedules.shopId, shop.id))
      .limit(1);
    const barberRows = await tx
      .select({
        id: barbers.id,
        name: barbers.name,
        archived: barbers.archived,
        week: barberSchedules.week,
        revision: barberSchedules.revision,
      })
      .from(barbers)
      .leftJoin(
        barberSchedules,
        and(
          eq(barberSchedules.shopId, barbers.shopId),
          eq(barberSchedules.barberId, barbers.id),
        ),
      )
      .where(eq(barbers.shopId, shop.id));
    const serviceRows = await tx
      .select({
        id: services.id,
        name: services.name,
        durationMinutes: services.durationMinutes,
        barberId: barberServices.barberId,
      })
      .from(services)
      .leftJoin(
        barberServices,
        and(
          eq(barberServices.shopId, services.shopId),
          eq(barberServices.serviceId, services.id),
        ),
      )
      .where(
        and(
          eq(services.shopId, shop.id),
          eq(services.offered, true),
          eq(services.archived, false),
        ),
      );
    const grouped = new Map<string, AvailabilityData["services"][number]>();
    for (const row of serviceRows) {
      const view = grouped.get(row.id) ?? {
        id: row.id,
        name: row.name,
        durationMinutes: row.durationMinutes,
        barberIds: [],
      };
      if (row.barberId) view.barberIds.push(row.barberId);
      grouped.set(row.id, view);
    }
    return {
      timeZone: shop.timeZone,
      shop: {
        week: shopSchedule?.week ?? emptyWeek(),
        revision: shopSchedule?.revision ?? 0,
      },
      barbers: barberRows.map((row) => ({
        id: row.id,
        name: row.name,
        archived: row.archived,
        schedule: {
          week: row.week ?? emptyWeek(),
          revision: row.revision ?? 0,
        },
      })),
      services: [...grouped.values()],
    };
  });
}

export async function previewOwnSlots(
  context: OwnerContext | null,
  input: unknown,
): Promise<
  ActionResult<{
    timeZone: string;
    date: string;
    slots: ReturnType<typeof calculateSlots>;
  }>
> {
  if (!context)
    return {
      success: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in to preview availability.",
      },
    };
  const parsed = previewSlotsSchema.safeParse(input);
  if (!parsed.success)
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Choose a valid service, barber, and date.",
      },
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
      );
      const [shop] = await tx
        .select({ id: shops.id, timeZone: shops.timeZone })
        .from(shops)
        .where(eq(shops.ownerId, context.userId))
        .limit(1);
      if (!shop)
        return {
          success: false as const,
          error: {
            code: "SHOP_REQUIRED",
            message: "Set up your shop before previewing availability.",
          },
        };
      const [service] = await tx
        .select({ id: services.id, durationMinutes: services.durationMinutes })
        .from(services)
        .where(
          and(
            eq(services.id, parsed.data.serviceId),
            eq(services.shopId, shop.id),
            eq(services.offered, true),
            eq(services.archived, false),
          ),
        )
        .limit(1);
      const [barber] = await tx
        .select({ id: barbers.id })
        .from(barbers)
        .innerJoin(
          barberServices,
          and(
            eq(barberServices.shopId, barbers.shopId),
            eq(barberServices.barberId, barbers.id),
          ),
        )
        .where(
          and(
            eq(barbers.id, parsed.data.barberId),
            eq(barbers.shopId, shop.id),
            eq(barbers.archived, false),
            eq(barberServices.serviceId, parsed.data.serviceId),
          ),
        )
        .limit(1);
      if (!service || !barber)
        return {
          success: false as const,
          error: {
            code: "INVALID_PAIRING",
            message: "Choose an offered service and an active eligible barber.",
          },
        };
      const [shopSchedule] = await tx
        .select()
        .from(shopSchedules)
        .where(eq(shopSchedules.shopId, shop.id))
        .limit(1);
      const [barberSchedule] = await tx
        .select()
        .from(barberSchedules)
        .where(
          and(
            eq(barberSchedules.shopId, shop.id),
            eq(barberSchedules.barberId, barber.id),
          ),
        )
        .limit(1);
      const localDate = Temporal.PlainDate.from(parsed.data.date);
      const index = localDate.dayOfWeek - 1;
      const shopWeek = shopSchedule?.week ?? emptyWeek();
      const barberWeek = barberSchedule?.week ?? emptyWeek();
      const now = new Date(Date.now()).toISOString();
      return {
        success: true as const,
        data: {
          timeZone: shop.timeZone,
          date: parsed.data.date,
          slots: calculateSlots({
            date: parsed.data.date,
            timeZone: shop.timeZone,
            now,
            durationMinutes: Number(service.durationMinutes),
            shopDay: shopWeek[index] as DaySchedule,
            barberDay: barberWeek[index] as DaySchedule,
          }),
        },
      };
    });
  } catch {
    return {
      success: false,
      error: {
        code: "PREVIEW_FAILED",
        message: "Unable to preview current availability. Try again.",
      },
    };
  }
}

export type { PreviewSlotsInput };
