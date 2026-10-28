import "server-only";
import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import {
  barberDateSchedules,
  barberSchedules,
  shopDateSchedules,
  shopSchedules,
} from "@/db/schema/availability";
import { resolveDateSchedule } from "./restrictions";
import type { DaySchedule, WeeklySchedule } from "./types";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type ResolvedDaySchedule = {
  hasWeeklySchedule: boolean;
  shopDay: DaySchedule;
  barberDay: DaySchedule;
};

const emptyWeek = (): WeeklySchedule =>
  Array.from({ length: 7 }, () => ({ working: [], breaks: [] }));

export async function resolveScheduleForDate(
  tx: Transaction,
  params: {
    shopId: string;
    barberId: string;
    date: string | Temporal.PlainDate;
  },
): Promise<ResolvedDaySchedule> {
  const [shopSchedule] = await tx
    .select({ week: shopSchedules.week })
    .from(shopSchedules)
    .where(eq(shopSchedules.shopId, params.shopId))
    .limit(1);

  const [barberSchedule] = await tx
    .select({ week: barberSchedules.week })
    .from(barberSchedules)
    .where(
      and(
        eq(barberSchedules.shopId, params.shopId),
        eq(barberSchedules.barberId, params.barberId),
      ),
    )
    .limit(1);

  const hasWeeklySchedule = Boolean(shopSchedule && barberSchedule);

  const localDate =
    typeof params.date === "string"
      ? Temporal.PlainDate.from(params.date)
      : params.date;
  const dateString = localDate.toString();
  const weekday = localDate.dayOfWeek - 1;

  const [shopException] = await tx
    .select({
      override: shopDateSchedules.override,
      closed: shopDateSchedules.closed,
      revision: shopDateSchedules.revision,
    })
    .from(shopDateSchedules)
    .where(
      and(
        eq(shopDateSchedules.shopId, params.shopId),
        eq(shopDateSchedules.date, dateString),
      ),
    )
    .limit(1);

  const [barberException] = await tx
    .select({
      override: barberDateSchedules.override,
      closed: barberDateSchedules.closed,
      revision: barberDateSchedules.revision,
    })
    .from(barberDateSchedules)
    .where(
      and(
        eq(barberDateSchedules.shopId, params.shopId),
        eq(barberDateSchedules.barberId, params.barberId),
        eq(barberDateSchedules.date, dateString),
      ),
    )
    .limit(1);

  const shopWeek =
    (shopSchedule?.week as WeeklySchedule | undefined) ?? emptyWeek();
  const barberWeek =
    (barberSchedule?.week as WeeklySchedule | undefined) ?? emptyWeek();

  const shopDay = resolveDateSchedule(
    shopWeek[weekday] as DaySchedule,
    shopException
      ? {
          override: shopException.override,
          closed: shopException.closed ?? false,
          revision: shopException.revision ?? 0,
        }
      : null,
  );

  const barberDay = resolveDateSchedule(
    barberWeek[weekday] as DaySchedule,
    barberException
      ? {
          override: barberException.override,
          closed: barberException.closed ?? false,
          revision: barberException.revision ?? 0,
        }
      : null,
  );

  return {
    hasWeeklySchedule,
    shopDay,
    barberDay,
  };
}
