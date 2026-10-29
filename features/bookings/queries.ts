import "server-only";
import { and, asc, desc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { bookings } from "@/db/schema/bookings";
import { notificationWork } from "@/db/schema/notification-work";
import { shops } from "@/db/schema/shops";
import { barbers, barberServices, services } from "@/db/schema/catalog";
import { occupiedIntervals } from "@/db/schema/occupancy";
import { calculateSlots } from "@/features/availability/slots";
import { resolveScheduleForDate } from "@/features/availability/schedule-resolution";
import type { ActionResult } from "@/lib/action-result";
import { hashSecret } from "./capabilities";
import type {
  CustomerReplacementChoices,
  CustomerReplacementSlotsView,
  ManagedBookingView,
  OwnerAppointmentChoices,
  OwnerAppointmentMoveChoices,
  OwnerAppointmentView,
  OwnerCalendarView,
  PublicBookingContext,
} from "./types";
import type { OwnerContext } from "@/server/owner-context";
import { customerEmailSummary } from "@/features/notifications/customer-summary";

const unavailable = {
  success: false,
  error: { code: "UNAVAILABLE", message: "This booking link is unavailable." },
} as const;

function dateBounds(date: string, timeZone: string) {
  const day = Temporal.PlainDate.from(date);
  const start = day.toZonedDateTime({ timeZone }).toInstant();
  const end = day.add({ days: 1 }).toZonedDateTime({ timeZone }).toInstant();
  return [
    new Date(start.epochMilliseconds),
    new Date(end.epochMilliseconds),
  ] as const;
}

function latestEmailNotification() {
  return db
    .select({
      status: notificationWork.status,
      reason: notificationWork.reason,
      claimedAt: notificationWork.claimedAt,
      updatedAt: notificationWork.updatedAt,
    })
    .from(notificationWork)
    .where(
      and(
        eq(notificationWork.bookingId, bookings.id),
        eq(notificationWork.channel, "email"),
        or(
          and(
            eq(bookings.revision, 0),
            eq(notificationWork.bookingRevision, 0),
            eq(notificationWork.kind, "customer_confirmation"),
          ),
          and(
            gt(bookings.revision, 0),
            eq(notificationWork.bookingRevision, bookings.revision),
            inArray(notificationWork.kind, [
              "customer_move",
              "customer_cancellation",
            ]),
          ),
        ),
      ),
    )
    .orderBy(desc(notificationWork.createdAt))
    .limit(1)
    .as("latest_email_notification");
}

export async function getManagedBooking(
  context: Pick<PublicBookingContext, "shopId"> | null,
  token: string,
): Promise<ActionResult<ManagedBookingView>> {
  if (!context?.shopId || typeof token !== "string") return unavailable;
  const now = new Date();
  try {
    const emailWork = latestEmailNotification();
    const [row] = await db
      .select({
        revision: bookings.revision,
        status: bookings.status,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        serviceName: bookings.serviceName,
        servicePriceUsd: bookings.servicePriceUsd,
        serviceDurationMinutes: bookings.serviceDurationMinutes,
        barberName: bookings.barberName,
        customerName: bookings.customerName,
        customerEmail: bookings.customerEmail,
        customerPhone: bookings.customerPhone,
        whatsappOptIn: bookings.whatsappOptIn,
        capabilityRevokedAt: bookings.capabilityRevokedAt,
        shopName: shops.name,
        publicContact: shops.publicContact,
        address: shops.address,
        timeZone: shops.timeZone,
        emailStatus: emailWork.status,
        emailReason: emailWork.reason,
        emailClaimedAt: emailWork.claimedAt,
        emailUpdatedAt: emailWork.updatedAt,
      })
      .from(bookings)
      .innerJoin(shops, eq(shops.id, bookings.shopId))
      .leftJoinLateral(emailWork, sql`true`)
      .where(
        and(
          eq(bookings.shopId, context.shopId),
          eq(bookings.capabilityHash, hashSecret(token)),
        ),
      )
      .limit(1);
    if (
      !row ||
      row.capabilityRevokedAt ||
      now.getTime() >= row.endAt.getTime() + 168 * 60 * 60_000
    )
      return unavailable;
    return {
      success: true,
      data: {
        revision: row.revision,
        status: row.status as "confirmed" | "cancelled",
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
        service: {
          name: row.serviceName,
          priceUsd: row.servicePriceUsd,
          durationMinutes: row.serviceDurationMinutes,
        },
        barber: { name: row.barberName },
        customer: {
          name: row.customerName,
          email: row.customerEmail,
          phone: row.customerPhone,
          whatsappOptIn: row.whatsappOptIn,
        },
        shop: {
          name: row.shopName,
          publicContact: row.publicContact,
          address: row.address,
          timeZone: row.timeZone,
        },
        notifications: {
          email: customerEmailSummary(
            {
              status: row.emailStatus as
                ManagedBookingView["notifications"]["email"]["status"] | null,
              reason: row.emailReason,
              claimedAt: row.emailClaimedAt,
              updatedAt: row.emailUpdatedAt,
            },
            now,
          ),
        },
        past: row.endAt.getTime() <= now.getTime(),
        changeCutoffPassed:
          row.status !== "confirmed" ||
          row.startAt.getTime() - now.getTime() < 12 * 60 * 60_000,
      },
    };
  } catch {
    return unavailable;
  }
}

function ownerError(code: string, message: string) {
  return { success: false, error: { code, message } } as const;
}

async function ownShop(context: OwnerContext | null) {
  if (!context?.userId) return null;
  const [shop] = await db
    .select()
    .from(shops)
    .where(eq(shops.ownerId, context.userId))
    .limit(1);
  return shop ?? null;
}

export async function getOwnCalendar(
  context: OwnerContext | null,
  input: { date: string; view: "day" | "week"; barberId?: string },
): Promise<ActionResult<OwnerCalendarView>> {
  if (!context?.userId)
    return ownerError("UNAUTHENTICATED", "Sign in to view your calendar.");
  let date: Temporal.PlainDate;
  try {
    if (
      !input ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
      !["day", "week"].includes(input.view)
    )
      throw new Error();
    date = Temporal.PlainDate.from(input.date);
  } catch {
    return ownerError("VALIDATION_ERROR", "Choose a valid calendar date.");
  }
  try {
    const shop = await ownShop(context);
    if (!shop)
      return ownerError(
        "SHOP_REQUIRED",
        "Set up your shop to view its calendar.",
      );
    const firstDate =
      input.view === "week"
        ? date.subtract({ days: date.dayOfWeek - 1 })
        : date;
    const lastDate = firstDate.add({ days: input.view === "week" ? 7 : 1 });
    const rangeStart = firstDate
      .toZonedDateTime({ timeZone: shop.timeZone })
      .toInstant();
    const rangeEnd = lastDate
      .toZonedDateTime({ timeZone: shop.timeZone })
      .toInstant();
    const [barberFilter] = input.barberId
      ? await db
          .select({ id: barbers.id })
          .from(barbers)
          .where(
            and(eq(barbers.shopId, shop.id), eq(barbers.id, input.barberId)),
          )
          .limit(1)
      : [undefined];
    if (input.barberId && !barberFilter)
      return ownerError("VALIDATION_ERROR", "Choose one of your barbers.");
    const barberRows = await db
      .select({
        id: barbers.id,
        name: barbers.name,
        archived: barbers.archived,
      })
      .from(barbers)
      .where(eq(barbers.shopId, shop.id));
    const rows = await db
      .select({
        id: bookings.id,
        status: bookings.status,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        serviceName: bookings.serviceName,
        servicePriceUsd: bookings.servicePriceUsd,
        serviceDurationMinutes: bookings.serviceDurationMinutes,
        barberId: bookings.barberId,
        barberName: bookings.barberName,
        customerName: bookings.customerName,
      })
      .from(bookings)
      .innerJoin(
        shops,
        and(eq(shops.id, bookings.shopId), eq(shops.ownerId, context.userId)),
      )
      .where(
        and(
          lt(bookings.startAt, new Date(rangeEnd.epochMilliseconds)),
          gt(bookings.endAt, new Date(rangeStart.epochMilliseconds)),
          ...(input.barberId ? [eq(bookings.barberId, input.barberId)] : []),
        ),
      )
      .orderBy(bookings.startAt);
    return {
      success: true,
      data: {
        timeZone: shop.timeZone,
        range: { startAt: rangeStart.toString(), endAt: rangeEnd.toString() },
        barbers: barberRows,
        appointments: rows.map((row) => ({
          id: row.id,
          status: row.status as "confirmed" | "cancelled",
          startAt: row.startAt.toISOString(),
          endAt: row.endAt.toISOString(),
          service: {
            name: row.serviceName,
            priceUsd: row.servicePriceUsd,
            durationMinutes: row.serviceDurationMinutes,
          },
          barber: {
            id: row.barberId,
            name: row.barberName,
            archived:
              barberRows.find((b) => b.id === row.barberId)?.archived ?? true,
          },
          customer: { name: row.customerName },
        })),
      },
    };
  } catch {
    return ownerError(
      "UNAVAILABLE",
      "Your calendar could not be loaded. Try again.",
    );
  }
}

export async function getOwnAppointment(
  context: OwnerContext | null,
  appointmentId: string,
): Promise<ActionResult<OwnerAppointmentView>> {
  if (!context?.userId)
    return ownerError("UNAUTHENTICATED", "Sign in to view appointments.");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      appointmentId,
    )
  )
    return ownerError("NOT_FOUND", "Appointment not found.");
  try {
    if (!(await ownShop(context)))
      return ownerError(
        "SHOP_REQUIRED",
        "Set up your shop to view appointments.",
      );
    const emailWork = latestEmailNotification();
    const row = await db
      .select({
        id: bookings.id,
        revision: bookings.revision,
        status: bookings.status,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        serviceId: bookings.serviceId,
        serviceName: bookings.serviceName,
        servicePriceUsd: bookings.servicePriceUsd,
        serviceDurationMinutes: bookings.serviceDurationMinutes,
        barberId: bookings.barberId,
        barberName: bookings.barberName,
        customerName: bookings.customerName,
        customerEmail: bookings.customerEmail,
        customerPhone: bookings.customerPhone,
        whatsappOptIn: bookings.whatsappOptIn,
        barberArchived: barbers.archived,
        shopName: shops.name,
        shopPublicContact: shops.publicContact,
        shopAddress: shops.address,
        shopTimeZone: shops.timeZone,
        emailStatus: emailWork.status,
        emailReason: emailWork.reason,
        emailClaimedAt: emailWork.claimedAt,
        emailUpdatedAt: emailWork.updatedAt,
      })
      .from(bookings)
      .innerJoin(
        shops,
        and(eq(shops.id, bookings.shopId), eq(shops.ownerId, context.userId)),
      )
      .leftJoin(
        barbers,
        and(
          eq(barbers.id, bookings.barberId),
          eq(barbers.shopId, bookings.shopId),
        ),
      )
      .leftJoinLateral(emailWork, sql`true`)
      .where(eq(bookings.id, appointmentId))
      .limit(1);
    const found = row[0];
    if (!found) return ownerError("NOT_FOUND", "Appointment not found.");
    return {
      success: true,
      data: {
        id: found.id,
        revision: found.revision,
        status: found.status as "confirmed" | "cancelled",
        startAt: found.startAt.toISOString(),
        endAt: found.endAt.toISOString(),
        service: {
          id: found.serviceId,
          name: found.serviceName,
          priceUsd: found.servicePriceUsd,
          durationMinutes: found.serviceDurationMinutes,
        },
        barber: {
          id: found.barberId,
          name: found.barberName,
          archived: found.barberArchived ?? true,
        },
        customer: {
          name: found.customerName,
          email: found.customerEmail,
          phone: found.customerPhone,
          whatsappOptIn: found.whatsappOptIn,
        },
        shop: {
          name: found.shopName,
          publicContact: found.shopPublicContact,
          address: found.shopAddress,
          timeZone: found.shopTimeZone,
        },
        notifications: {
          email: customerEmailSummary(
            {
              status: found.emailStatus as
                ManagedBookingView["notifications"]["email"]["status"] | null,
              reason: found.emailReason,
              claimedAt: found.emailClaimedAt,
              updatedAt: found.emailUpdatedAt,
            },
            new Date(),
          ),
        },
      },
    };
  } catch {
    return ownerError(
      "UNAVAILABLE",
      "Appointment details could not be loaded. Try again.",
    );
  }
}

export async function getOwnAppointmentChoices(
  context: OwnerContext | null,
): Promise<ActionResult<OwnerAppointmentChoices>> {
  if (!context?.userId)
    return ownerError("UNAUTHENTICATED", "Sign in to create appointments.");
  try {
    const shop = await ownShop(context);
    if (!shop)
      return ownerError(
        "SHOP_REQUIRED",
        "Set up your shop to create appointments.",
      );
    const barberRows = await db
      .select({ id: barbers.id, name: barbers.name })
      .from(barbers)
      .where(and(eq(barbers.shopId, shop.id), eq(barbers.archived, false)));
    const serviceRows = await db
      .select({
        id: services.id,
        name: services.name,
        priceUsd: services.priceUsd,
        durationMinutes: services.durationMinutes,
        barberId: barberServices.barberId,
      })
      .from(services)
      .innerJoin(
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
    const grouped = new Map<
      string,
      OwnerAppointmentChoices["services"][number]
    >();
    for (const row of serviceRows) {
      if (!barberRows.some((barber) => barber.id === row.barberId)) continue;
      const item = grouped.get(row.id) ?? {
        id: row.id,
        name: row.name,
        priceUsd: row.priceUsd,
        durationMinutes: Number(row.durationMinutes),
        barberIds: [],
      };
      item.barberIds.push(row.barberId);
      grouped.set(row.id, item);
    }
    return {
      success: true,
      data: {
        timeZone: shop.timeZone,
        barbers: barberRows,
        services: [...grouped.values()],
      },
    };
  } catch {
    return ownerError(
      "UNAVAILABLE",
      "Appointment choices could not be loaded. Try again.",
    );
  }
}

export async function getOwnAppointmentMoveChoices(
  context: OwnerContext | null,
  appointmentId: string,
): Promise<ActionResult<OwnerAppointmentMoveChoices>> {
  if (!context?.userId)
    return ownerError("UNAUTHENTICATED", "Sign in to manage appointments.");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      appointmentId,
    )
  )
    return ownerError("NOT_FOUND", "Appointment not found.");
  try {
    const shop = await ownShop(context);
    if (!shop)
      return ownerError(
        "SHOP_REQUIRED",
        "Set up your shop to manage appointments.",
      );
    const [booking] = await db
      .select({
        serviceId: bookings.serviceId,
        serviceName: bookings.serviceName,
        servicePriceUsd: bookings.servicePriceUsd,
        serviceDurationMinutes: bookings.serviceDurationMinutes,
      })
      .from(bookings)
      .where(and(eq(bookings.id, appointmentId), eq(bookings.shopId, shop.id)))
      .limit(1);
    if (!booking) return ownerError("NOT_FOUND", "Appointment not found.");
    const barberRows = await db
      .select({ id: barbers.id, name: barbers.name })
      .from(barbers)
      .where(and(eq(barbers.shopId, shop.id), eq(barbers.archived, false)));
    const serviceRows = await db
      .select({
        id: services.id,
        name: services.name,
        priceUsd: services.priceUsd,
        durationMinutes: services.durationMinutes,
        offered: services.offered,
        barberId: barberServices.barberId,
      })
      .from(services)
      .innerJoin(
        barberServices,
        and(
          eq(barberServices.shopId, services.shopId),
          eq(barberServices.serviceId, services.id),
        ),
      )
      .where(
        and(
          eq(services.shopId, shop.id),
          eq(services.archived, false),
          or(eq(services.offered, true), eq(services.id, booking.serviceId)),
        ),
      )
      .orderBy(asc(services.name), asc(services.id));
    const grouped = new Map<
      string,
      OwnerAppointmentMoveChoices["services"][number]
    >();
    for (const row of serviceRows) {
      if (!barberRows.some((barber) => barber.id === row.barberId)) continue;
      const isSavedService = row.id === booking.serviceId;
      const item = grouped.get(row.id) ?? {
        id: row.id,
        name: isSavedService ? booking.serviceName : row.name,
        priceUsd: isSavedService ? booking.servicePriceUsd : row.priceUsd,
        durationMinutes: isSavedService
          ? booking.serviceDurationMinutes
          : Number(row.durationMinutes),
        barberIds: [],
        hidden: !row.offered,
      };
      item.barberIds.push(row.barberId);
      grouped.set(row.id, item);
    }
    return {
      success: true,
      data: {
        timeZone: shop.timeZone,
        barbers: barberRows,
        services: [...grouped.values()],
      },
    };
  } catch {
    return ownerError(
      "UNAVAILABLE",
      "Appointment choices could not be loaded. Try again.",
    );
  }
}

export async function getCustomerReplacementChoices(
  context: Pick<PublicBookingContext, "shopId"> | null,
  token: string,
): Promise<ActionResult<CustomerReplacementChoices>> {
  if (!context?.shopId || typeof token !== "string") return unavailable;
  const now = new Date();
  try {
    const [booking] = await db
      .select({
        id: bookings.id,
        revision: bookings.revision,
        status: bookings.status,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        serviceId: bookings.serviceId,
        serviceName: bookings.serviceName,
        servicePriceUsd: bookings.servicePriceUsd,
        serviceDurationMinutes: bookings.serviceDurationMinutes,
        capabilityRevokedAt: bookings.capabilityRevokedAt,
        shopId: shops.id,
        timeZone: shops.timeZone,
      })
      .from(bookings)
      .innerJoin(shops, eq(shops.id, bookings.shopId))
      .where(
        and(
          eq(bookings.shopId, context.shopId),
          eq(bookings.capabilityHash, hashSecret(token)),
        ),
      )
      .limit(1);

    if (
      !booking ||
      booking.capabilityRevokedAt ||
      now.getTime() >= booking.endAt.getTime() + 168 * 60 * 60_000
    ) {
      return unavailable;
    }

    if (booking.status !== "confirmed") {
      return {
        success: false,
        error: {
          code: "INVALID_STATE",
          message: "This appointment can no longer be changed.",
        },
      };
    }

    if (booking.startAt.getTime() - now.getTime() < 12 * 60 * 60_000) {
      return {
        success: false,
        error: {
          code: "CUTOFF_PASSED",
          message:
            "This appointment is inside the change window. Contact the shop.",
        },
      };
    }

    const barberRows = await db
      .select({ id: barbers.id, name: barbers.name })
      .from(barbers)
      .where(
        and(eq(barbers.shopId, booking.shopId), eq(barbers.archived, false)),
      );

    const serviceRows = await db
      .select({
        id: services.id,
        name: services.name,
        priceUsd: services.priceUsd,
        durationMinutes: services.durationMinutes,
        offered: services.offered,
        barberId: barberServices.barberId,
      })
      .from(services)
      .innerJoin(
        barberServices,
        and(
          eq(barberServices.shopId, services.shopId),
          eq(barberServices.serviceId, services.id),
        ),
      )
      .where(
        and(
          eq(services.shopId, booking.shopId),
          eq(services.archived, false),
          or(eq(services.offered, true), eq(services.id, booking.serviceId)),
        ),
      )
      .orderBy(asc(services.name), asc(services.id));

    const grouped = new Map<
      string,
      CustomerReplacementChoices["services"][number]
    >();
    for (const row of serviceRows) {
      if (!barberRows.some((barber) => barber.id === row.barberId)) continue;
      const isSavedService = row.id === booking.serviceId;
      const item = grouped.get(row.id) ?? {
        id: row.id,
        name: isSavedService ? booking.serviceName : row.name,
        priceUsd: isSavedService ? booking.servicePriceUsd : row.priceUsd,
        durationMinutes: isSavedService
          ? booking.serviceDurationMinutes
          : Number(row.durationMinutes),
        barberIds: [],
        hidden: !row.offered,
      };
      item.barberIds.push(row.barberId);
      grouped.set(row.id, item);
    }

    return {
      success: true,
      data: {
        bookingId: booking.id,
        revision: booking.revision,
        timeZone: booking.timeZone,
        serverNow: now.toISOString(),
        retainedService: {
          id: booking.serviceId,
          name: booking.serviceName,
          priceUsd: booking.servicePriceUsd,
          durationMinutes: booking.serviceDurationMinutes,
        },
        barbers: barberRows,
        services: [...grouped.values()],
      },
    };
  } catch {
    return unavailable;
  }
}

export async function getCustomerReplacementSlots(
  context: Pick<PublicBookingContext, "shopId"> | null,
  input: unknown,
): Promise<ActionResult<CustomerReplacementSlotsView>> {
  if (!context?.shopId || typeof input !== "object" || input === null)
    return unavailable;
  const raw = input as Record<string, unknown>;
  const token = typeof raw.token === "string" ? raw.token : "";
  if (!token) return unavailable;

  const now = new Date();
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
      );

      const [booking] = await tx
        .select({
          id: bookings.id,
          revision: bookings.revision,
          status: bookings.status,
          startAt: bookings.startAt,
          endAt: bookings.endAt,
          serviceId: bookings.serviceId,
          serviceDurationMinutes: bookings.serviceDurationMinutes,
          occupancyId: bookings.occupancyId,
          capabilityRevokedAt: bookings.capabilityRevokedAt,
          shopId: shops.id,
          timeZone: shops.timeZone,
        })
        .from(bookings)
        .innerJoin(shops, eq(shops.id, bookings.shopId))
        .where(
          and(
            eq(bookings.shopId, context.shopId),
            eq(bookings.capabilityHash, hashSecret(token)),
          ),
        )
        .limit(1);

      if (
        !booking ||
        booking.capabilityRevokedAt ||
        now.getTime() >= booking.endAt.getTime() + 168 * 60 * 60_000
      ) {
        return unavailable;
      }

      const expectedRevision =
        typeof raw.expectedRevision === "number" &&
        Number.isInteger(raw.expectedRevision)
          ? raw.expectedRevision
          : -1;
      const serviceId = typeof raw.serviceId === "string" ? raw.serviceId : "";
      const barberId = typeof raw.barberId === "string" ? raw.barberId : "";
      const date = typeof raw.date === "string" ? raw.date : "";

      if (
        expectedRevision < 0 ||
        !serviceId ||
        !barberId ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
      ) {
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid replacement slots input.",
          },
        };
      }

      if (booking.status !== "confirmed") {
        return {
          success: false,
          error: {
            code: "INVALID_STATE",
            message: "This appointment can no longer be changed.",
          },
        };
      }

      if (booking.startAt.getTime() - now.getTime() < 12 * 60 * 60_000) {
        return {
          success: false,
          error: {
            code: "CUTOFF_PASSED",
            message:
              "This appointment is inside the change window. Contact the shop.",
          },
        };
      }

      if (booking.revision !== expectedRevision) {
        return {
          success: false,
          error: {
            code: "STALE_BOOKING",
            message: "Appointment changed. Reload and try again.",
          },
        };
      }

      let durationMinutes: number;
      if (serviceId === booking.serviceId) {
        const [serviceRow] = await tx
          .select({ id: services.id })
          .from(services)
          .where(
            and(
              eq(services.id, serviceId),
              eq(services.shopId, booking.shopId),
              eq(services.archived, false),
            ),
          )
          .limit(1);
        if (!serviceRow) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Choose an offered service and an active eligible barber.",
            },
          };
        }
        durationMinutes = booking.serviceDurationMinutes;
      } else {
        const [serviceRow] = await tx
          .select({
            id: services.id,
            durationMinutes: services.durationMinutes,
          })
          .from(services)
          .where(
            and(
              eq(services.id, serviceId),
              eq(services.shopId, booking.shopId),
              eq(services.offered, true),
              eq(services.archived, false),
            ),
          )
          .limit(1);
        if (!serviceRow) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Choose an offered service and an active eligible barber.",
            },
          };
        }
        durationMinutes = Number(serviceRow.durationMinutes);
      }

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
            eq(barbers.id, barberId),
            eq(barbers.shopId, booking.shopId),
            eq(barbers.archived, false),
            eq(barberServices.serviceId, serviceId),
          ),
        )
        .limit(1);

      if (!barber) {
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Choose an offered service and an active eligible barber.",
          },
        };
      }

      const { shopDay, barberDay } = await resolveScheduleForDate(tx, {
        shopId: booking.shopId,
        barberId,
        date,
      });

      const [dateStart, dateEnd] = dateBounds(date, booking.timeZone);

      const occupiedRows = await tx
        .select({
          startAt: occupiedIntervals.startAt,
          endAt: occupiedIntervals.endAt,
        })
        .from(occupiedIntervals)
        .where(
          and(
            eq(occupiedIntervals.shopId, booking.shopId),
            eq(occupiedIntervals.barberId, barberId),
            sql`${occupiedIntervals.startAt} < ${dateEnd}`,
            sql`${occupiedIntervals.endAt} > ${dateStart}`,
            ...(booking.occupancyId
              ? [ne(occupiedIntervals.id, booking.occupancyId)]
              : []),
          ),
        );

      const slots =
        durationMinutes > (dateEnd.getTime() - dateStart.getTime()) / 60_000
          ? []
          : calculateSlots({
              date,
              timeZone: booking.timeZone,
              now: now.toISOString(),
              durationMinutes,
              shopDay,
              barberDay,
              occupied: occupiedRows.map(({ startAt, endAt }) => ({
                start: startAt.toISOString(),
                end: endAt.toISOString(),
              })),
            });

      return {
        success: true,
        data: {
          timeZone: booking.timeZone,
          date,
          serverNow: now.toISOString(),
          slots,
        },
      };
    });
  } catch {
    return unavailable;
  }
}
