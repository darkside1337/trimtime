import "server-only";
import { Temporal } from "temporal-polyfill";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema/bookings";
import {
  barberDateSchedules,
  barberSchedules,
  shopDateSchedules,
  shopSchedules,
} from "@/db/schema/availability";
import { shops } from "@/db/schema/shops";
import { fitsScheduleInterval } from "@/features/availability/slots";
import { resolveDateSchedule } from "@/features/availability/restrictions";
import type { WeeklySchedule } from "@/features/availability/types";

export class BookingProtectionError extends Error {
  constructor() {
    super("This change conflicts with a confirmed booking.");
    this.name = "BookingProtectionError";
  }
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function hasProtectedBooking(
  tx: Transaction,
  {
    shopId,
    serviceId,
    barberId,
  }: { shopId: string; serviceId?: string; barberId?: string },
) {
  const conditions = [
    eq(bookings.shopId, shopId),
    eq(bookings.status, "confirmed"),
    gt(bookings.endAt, new Date()),
  ];
  if (serviceId) conditions.push(eq(bookings.serviceId, serviceId));
  if (barberId) conditions.push(eq(bookings.barberId, barberId));
  return (
    (
      await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(...conditions))
        .limit(1)
    ).length > 0
  );
}

export async function assertBookingsFitCurrentSchedules(
  tx: Transaction,
  shopId: string,
  now = new Date(),
) {
  const [shop] = await tx
    .select({ timeZone: shops.timeZone })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) return;
  const protectedBookings = await tx
    .select({
      barberId: bookings.barberId,
      startAt: bookings.startAt,
      duration: bookings.serviceDurationMinutes,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.status, "confirmed"),
        gt(bookings.endAt, now),
      ),
    );
  for (const booking of protectedBookings) {
    const date = Temporal.Instant.from(booking.startAt.toISOString())
      .toZonedDateTimeISO(shop.timeZone)
      .toPlainDate();
    const [shopWeek] = await tx
      .select({ week: shopSchedules.week })
      .from(shopSchedules)
      .where(eq(shopSchedules.shopId, shopId))
      .limit(1);
    const [barberWeek] = await tx
      .select({ week: barberSchedules.week })
      .from(barberSchedules)
      .where(
        and(
          eq(barberSchedules.shopId, shopId),
          eq(barberSchedules.barberId, booking.barberId),
        ),
      )
      .limit(1);
    if (!shopWeek || !barberWeek) throw new BookingProtectionError();
    const [shopException] = await tx
      .select()
      .from(shopDateSchedules)
      .where(
        and(
          eq(shopDateSchedules.shopId, shopId),
          eq(shopDateSchedules.date, date.toString()),
        ),
      )
      .limit(1);
    const [barberException] = await tx
      .select()
      .from(barberDateSchedules)
      .where(
        and(
          eq(barberDateSchedules.shopId, shopId),
          eq(barberDateSchedules.barberId, booking.barberId),
          eq(barberDateSchedules.date, date.toString()),
        ),
      )
      .limit(1);
    const index = date.dayOfWeek - 1;
    const shopDay = resolveDateSchedule(
      (shopWeek.week as WeeklySchedule)[index],
      shopException
        ? {
            override: shopException.override,
            closed: shopException.closed,
            revision: shopException.revision,
          }
        : null,
    );
    const barberDay = resolveDateSchedule(
      (barberWeek.week as WeeklySchedule)[index],
      barberException
        ? {
            override: barberException.override,
            closed: barberException.closed,
            revision: barberException.revision,
          }
        : null,
    );
    if (
      !fitsScheduleInterval({
        start: Temporal.Instant.from(booking.startAt.toISOString()),
        durationMinutes: booking.duration,
        date,
        timeZone: shop.timeZone,
        shopDay,
        barberDay,
      })
    )
      throw new BookingProtectionError();
  }
}
