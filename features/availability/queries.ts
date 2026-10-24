import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { barberServices, barbers, services } from "@/db/schema/catalog";
import {
  barberDateSchedules,
  barberSchedules,
  shopDateSchedules,
  shopSchedules,
} from "@/db/schema/availability";
import { occupiedIntervals, timeBlocks } from "@/db/schema/occupancy";
import { shops } from "@/db/schema/shops";
import type { ActionResult } from "@/lib/action-result";
import type { OwnerContext } from "@/server/owner-context";
import { OwnerUnauthorizedError } from "@/features/shops/queries";
import { previewSlotsSchema, type PreviewSlotsInput } from "./schemas";
import { calculateSlots } from "./slots";
import type {
  DaySchedule,
  DateAvailabilityView,
  DateScheduleView,
  ScheduleView,
  WeeklySchedule,
} from "./types";
import { getDateAvailabilitySchema } from "./schemas";
import { resolveDateSchedule } from "./restrictions";

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

export type AvailabilityOverview = {
  weeklyOpenMinutes: number;
  activeBarberCount: number;
  exceptions: {
    id: string;
    date: string;
    kind: "shop-date" | "barber-date" | "block";
    target: string;
    barberId: string | null;
    archived: boolean;
    startAt: string | null;
    endAt: string | null;
    title: string;
    detail: string;
  }[];
};

const emptyWeek = (): WeeklySchedule =>
  Array.from({ length: 7 }, () => ({ working: [], breaks: [] }));

function dateBounds(date: string, timeZone: string) {
  const day = Temporal.PlainDate.from(date);
  const start = day.toZonedDateTime({ timeZone }).toInstant();
  const end = day.add({ days: 1 }).toZonedDateTime({ timeZone }).toInstant();
  return [
    new Date(start.epochMilliseconds),
    new Date(end.epochMilliseconds),
  ] as const;
}

function formatBlockBoundary(instant: Date, timeZone: string) {
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  const offset = new Intl.DateTimeFormat("en", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")
    ?.value.replace(/^GMT/, "UTC");
  return `${localTime} ${offset ?? ""}`;
}

function formatUTCInstant(instant: Date) {
  return instant
    .toISOString()
    .replace("T", " ")
    .replace(/\.000Z$/, "Z");
}

function dateView(
  row?: {
    override: DaySchedule | null;
    closed: boolean | null;
    revision: number | null;
  } | null,
): DateScheduleView {
  return {
    override: row?.override ?? null,
    closed: row?.closed ?? false,
    revision: row?.revision ?? 0,
  };
}

export async function getOwnDateAvailability(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<DateAvailabilityView>> {
  if (!context)
    return {
      success: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in to manage availability.",
      },
    };
  const parsed = getDateAvailabilitySchema.safeParse(input);
  if (!parsed.success)
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Choose a valid date." },
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
          error: { code: "SHOP_REQUIRED", message: "Set up your shop first." },
        };
      const [shopState] = await tx
        .select()
        .from(shopDateSchedules)
        .where(
          and(
            eq(shopDateSchedules.shopId, shop.id),
            eq(shopDateSchedules.date, parsed.data.date),
          ),
        )
        .limit(1);
      const barberRows = await tx
        .select({
          id: barbers.id,
          name: barbers.name,
          archived: barbers.archived,
          override: barberDateSchedules.override,
          closed: barberDateSchedules.closed,
          revision: barberDateSchedules.revision,
        })
        .from(barbers)
        .leftJoin(
          barberDateSchedules,
          and(
            eq(barberDateSchedules.shopId, barbers.shopId),
            eq(barberDateSchedules.barberId, barbers.id),
            eq(barberDateSchedules.date, parsed.data.date),
          ),
        )
        .where(eq(barbers.shopId, shop.id));
      const [start, end] = dateBounds(parsed.data.date, shop.timeZone);
      const blockRows = await tx
        .select({
          id: occupiedIntervals.id,
          barberId: occupiedIntervals.barberId,
          startAt: occupiedIntervals.startAt,
          endAt: occupiedIntervals.endAt,
          note: timeBlocks.note,
        })
        .from(occupiedIntervals)
        .innerJoin(timeBlocks, eq(timeBlocks.id, occupiedIntervals.id))
        .where(
          and(
            eq(occupiedIntervals.shopId, shop.id),
            sql`${occupiedIntervals.startAt} < ${end}`,
            sql`${occupiedIntervals.endAt} > ${start}`,
          ),
        );
      return {
        success: true as const,
        data: {
          date: parsed.data.date,
          timeZone: shop.timeZone,
          shop: dateView(shopState),
          barbers: barberRows.map((row) => ({
            id: row.id,
            name: row.name,
            archived: row.archived,
            schedule: dateView(row),
          })),
          blocks: blockRows.map((row) => ({
            id: row.id,
            barberId: row.barberId,
            start: row.startAt.toISOString(),
            end: row.endAt.toISOString(),
            note: row.note,
          })),
        },
      };
    });
  } catch {
    return {
      success: false,
      error: {
        code: "READ_FAILED",
        message: "Unable to load dated availability.",
      },
    };
  }
}

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

export async function getOwnAvailabilityOverview(
  context: OwnerContext | null,
): Promise<AvailabilityOverview | null> {
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
    const today = Temporal.Now.plainDateISO(shop.timeZone).toString();
    const now = new Date();
    const shopSchedule = await tx
      .select({ week: shopSchedules.week })
      .from(shopSchedules)
      .where(eq(shopSchedules.shopId, shop.id))
      .limit(1);
    const activeBarberRows = await tx
      .select({ week: barberSchedules.week })
      .from(barbers)
      .leftJoin(
        barberSchedules,
        and(
          eq(barberSchedules.shopId, barbers.shopId),
          eq(barberSchedules.barberId, barbers.id),
        ),
      )
      .where(and(eq(barbers.shopId, shop.id), eq(barbers.archived, false)));
    const shopDates = await tx
      .select({
        date: shopDateSchedules.date,
        override: shopDateSchedules.override,
        closed: shopDateSchedules.closed,
      })
      .from(shopDateSchedules)
      .where(
        and(
          eq(shopDateSchedules.shopId, shop.id),
          sql`${shopDateSchedules.date} >= ${today}::date`,
          sql`(${shopDateSchedules.closed} = true OR ${shopDateSchedules.override} IS NOT NULL)`,
        ),
      );
    const barberDates = await tx
      .select({
        id: barberDateSchedules.barberId,
        date: barberDateSchedules.date,
        name: barbers.name,
        override: barberDateSchedules.override,
        closed: barberDateSchedules.closed,
      })
      .from(barberDateSchedules)
      .innerJoin(
        barbers,
        and(
          eq(barbers.shopId, barberDateSchedules.shopId),
          eq(barbers.id, barberDateSchedules.barberId),
          eq(barbers.archived, false),
        ),
      )
      .where(
        and(
          eq(barberDateSchedules.shopId, shop.id),
          sql`${barberDateSchedules.date} >= ${today}::date`,
          sql`(${barberDateSchedules.closed} = true OR ${barberDateSchedules.override} IS NOT NULL)`,
        ),
      );
    const blocks = await tx
      .select({
        id: timeBlocks.id,
        barberId: occupiedIntervals.barberId,
        name: barbers.name,
        archived: barbers.archived,
        startAt: occupiedIntervals.startAt,
        endAt: occupiedIntervals.endAt,
        note: timeBlocks.note,
      })
      .from(timeBlocks)
      .innerJoin(occupiedIntervals, eq(occupiedIntervals.id, timeBlocks.id))
      .innerJoin(
        barbers,
        and(
          eq(barbers.shopId, occupiedIntervals.shopId),
          eq(barbers.id, occupiedIntervals.barberId),
        ),
      )
      .where(
        and(
          eq(occupiedIntervals.shopId, shop.id),
          sql`${occupiedIntervals.endAt} > ${now}`,
        ),
      );
    const week = shopSchedule[0]?.week ?? emptyWeek();
    const exceptions = [
      ...shopDates.map((item) => ({
        id: `shop-${item.date}`,
        date: item.date,
        kind: "shop-date" as const,
        target: "shop",
        barberId: null,
        archived: false,
        startAt: null,
        endAt: null,
        title: "Shop date exception",
        detail: [
          item.closed ? "Shop closed" : "",
          item.override ? "Replacement hours saved" : "",
        ]
          .filter(Boolean)
          .join(" · "),
      })),
      ...barberDates.map((item) => ({
        id: `barber-${item.id}-${item.date}`,
        date: item.date,
        kind: "barber-date" as const,
        target: item.id,
        barberId: item.id,
        archived: false,
        startAt: null,
        endAt: null,
        title: `${item.name} date exception`,
        detail: [
          item.closed ? "Barber day off" : "",
          item.override ? "Replacement hours saved" : "",
        ]
          .filter(Boolean)
          .join(" · "),
      })),
      ...blocks.map((item) => ({
        id: item.id,
        date: Temporal.Instant.from(item.startAt.toISOString())
          .toZonedDateTimeISO(shop.timeZone)
          .toPlainDate()
          .toString(),
        kind: "block" as const,
        target: item.barberId,
        barberId: item.barberId,
        archived: item.archived,
        startAt: item.startAt.toISOString(),
        endAt: item.endAt.toISOString(),
        title: `${item.name} time block`,
        detail: `${formatBlockBoundary(item.startAt, shop.timeZone)}–${formatBlockBoundary(item.endAt, shop.timeZone)} · UTC ${formatUTCInstant(item.startAt)}–${formatUTCInstant(item.endAt)}${item.archived ? " · archived barber" : ""}${item.note ? ` · ${item.note}` : ""}`,
      })),
    ].sort((left, right) => left.date.localeCompare(right.date));
    return {
      weeklyOpenMinutes: week.reduce(
        (total, day) =>
          total +
          day.working.reduce(
            (minutes, range) => minutes + range.end - range.start,
            0,
          ) -
          day.breaks.reduce(
            (minutes, range) => minutes + range.end - range.start,
            0,
          ),
        0,
      ),
      activeBarberCount: activeBarberRows.filter((barber) =>
        barber.week?.some((day) => day.working.length > 0),
      ).length,
      exceptions,
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
      const [shopDate] = await tx
        .select()
        .from(shopDateSchedules)
        .where(
          and(
            eq(shopDateSchedules.shopId, shop.id),
            eq(shopDateSchedules.date, parsed.data.date),
          ),
        )
        .limit(1);
      const [barberDate] = await tx
        .select()
        .from(barberDateSchedules)
        .where(
          and(
            eq(barberDateSchedules.shopId, shop.id),
            eq(barberDateSchedules.barberId, barber.id),
            eq(barberDateSchedules.date, parsed.data.date),
          ),
        )
        .limit(1);
      const shopWeek = shopSchedule?.week ?? emptyWeek();
      const barberWeek = barberSchedule?.week ?? emptyWeek();
      const [dateStart, dateEnd] = dateBounds(parsed.data.date, shop.timeZone);
      const occupiedRows = await tx
        .select({
          startAt: occupiedIntervals.startAt,
          endAt: occupiedIntervals.endAt,
        })
        .from(occupiedIntervals)
        .where(
          and(
            eq(occupiedIntervals.shopId, shop.id),
            eq(occupiedIntervals.barberId, barber.id),
            sql`${occupiedIntervals.startAt} < ${dateEnd}`,
            sql`${occupiedIntervals.endAt} > ${dateStart}`,
          ),
        );
      const now = new Date(Date.now()).toISOString();
      const durationMinutes = Number(service.durationMinutes);
      return {
        success: true as const,
        data: {
          timeZone: shop.timeZone,
          date: parsed.data.date,
          slots:
            durationMinutes > (dateEnd.getTime() - dateStart.getTime()) / 60_000
              ? []
              : calculateSlots({
                  date: parsed.data.date,
                  timeZone: shop.timeZone,
                  now,
                  durationMinutes,
                  shopDay: resolveDateSchedule(
                    shopWeek[index] as DaySchedule,
                    dateView(shopDate),
                  ),
                  barberDay: resolveDateSchedule(
                    barberWeek[index] as DaySchedule,
                    dateView(barberDate),
                  ),
                  occupied: occupiedRows.map(({ startAt, endAt }) => ({
                    start: startAt.toISOString(),
                    end: endAt.toISOString(),
                  })),
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

export async function previewPublishedShopSlots(
  shopId: string,
  input: unknown,
) {
  const parsed = previewSlotsSchema.safeParse(input);
  if (!parsed.success) return null;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
    );
    const [shop] = await tx
      .select({ id: shops.id, timeZone: shops.timeZone })
      .from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.published, true)))
      .limit(1);
    if (!shop) return null;
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
    if (!service || !barber) return null;
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
    const index = Temporal.PlainDate.from(parsed.data.date).dayOfWeek - 1;
    const [shopDate] = await tx
      .select()
      .from(shopDateSchedules)
      .where(
        and(
          eq(shopDateSchedules.shopId, shop.id),
          eq(shopDateSchedules.date, parsed.data.date),
        ),
      )
      .limit(1);
    const [barberDate] = await tx
      .select()
      .from(barberDateSchedules)
      .where(
        and(
          eq(barberDateSchedules.shopId, shop.id),
          eq(barberDateSchedules.barberId, barber.id),
          eq(barberDateSchedules.date, parsed.data.date),
        ),
      )
      .limit(1);
    const [dateStart, dateEnd] = dateBounds(parsed.data.date, shop.timeZone);
    const occupiedRows = await tx
      .select({
        startAt: occupiedIntervals.startAt,
        endAt: occupiedIntervals.endAt,
      })
      .from(occupiedIntervals)
      .where(
        and(
          eq(occupiedIntervals.shopId, shop.id),
          eq(occupiedIntervals.barberId, barber.id),
          sql`${occupiedIntervals.startAt} < ${dateEnd}`,
          sql`${occupiedIntervals.endAt} > ${dateStart}`,
        ),
      );
    const durationMinutes = Number(service.durationMinutes);
    return {
      timeZone: shop.timeZone,
      date: parsed.data.date,
      slots:
        durationMinutes > (dateEnd.getTime() - dateStart.getTime()) / 60_000
          ? []
          : calculateSlots({
              date: parsed.data.date,
              timeZone: shop.timeZone,
              now: new Date().toISOString(),
              durationMinutes,
              shopDay: resolveDateSchedule(
                (shopSchedule?.week[index] as DaySchedule) ??
                  emptyWeek()[index]!,
                dateView(shopDate),
              ),
              barberDay: resolveDateSchedule(
                (barberSchedule?.week[index] as DaySchedule) ??
                  emptyWeek()[index]!,
                dateView(barberDate),
              ),
              occupied: occupiedRows.map(({ startAt, endAt }) => ({
                start: startAt.toISOString(),
                end: endAt.toISOString(),
              })),
            }),
    };
  });
}

export type { PreviewSlotsInput };
