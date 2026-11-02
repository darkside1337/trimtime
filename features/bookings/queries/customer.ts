import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema/bookings";
import { shops } from "@/db/schema/shops";
import { barbers, barberServices, services } from "@/db/schema/catalog";
import { getRetainedBookingOfferings } from "../booking-offerings";
import { queryValidatedSlots } from "@/features/availability/queries";
import { toManagedBookingView } from "../managed-booking-view";
import { latestEmailNotification } from "./latest-notification";
import type { ActionResult } from "@/lib/action-result";
import { hashSecret } from "../capabilities";
import type {
  BookingStatus,
  CustomerReplacementChoices,
  CustomerReplacementSlotsView,
  ManagedBookingView,
  PublicBookingContext,
} from "../types";
import { customerEmailSummary } from "@/features/notifications/customer-summary";
import {
  isCustomerChangeCutoffPassed,
  isCustomerManageLinkValid,
} from "../customer-primitives";

const unavailable = {
  success: false,
  error: { code: "UNAVAILABLE", message: "This booking link is unavailable." },
} as const;

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
      !isCustomerManageLinkValid(row.endAt, row.capabilityRevokedAt, now)
    )
      return unavailable;
    return {
      success: true,
      data: toManagedBookingView(
        {
          ...row,
          status: row.status as BookingStatus,
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
        },
        now,
      ),
    };
  } catch {
    return unavailable;
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
      !isCustomerManageLinkValid(
        booking.endAt,
        booking.capabilityRevokedAt,
        now,
      )
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

    if (isCustomerChangeCutoffPassed(booking.startAt, now)) {
      return {
        success: false,
        error: {
          code: "CUTOFF_PASSED",
          message:
            "This appointment is inside the change window. Contact the shop.",
        },
      };
    }

    const offerings = await getRetainedBookingOfferings(db, {
      shopId: booking.shopId,
      retained: {
        serviceId: booking.serviceId,
        serviceName: booking.serviceName,
        servicePriceUsd: booking.servicePriceUsd,
        serviceDurationMinutes: booking.serviceDurationMinutes,
      },
    });

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
        ...offerings,
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
        !isCustomerManageLinkValid(
          booking.endAt,
          booking.capabilityRevokedAt,
          now,
        )
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

      if (isCustomerChangeCutoffPassed(booking.startAt, now)) {
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

      const slots = await queryValidatedSlots(tx, {
        shopId: booking.shopId,
        timeZone: booking.timeZone,
        barberId,
        date,
        durationMinutes,
        now,
        excludeOccupancyId: booking.occupancyId,
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
