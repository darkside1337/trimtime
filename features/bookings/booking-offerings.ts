import "server-only";
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { barbers, barberServices, services } from "@/db/schema/catalog";
import type { OwnerAppointmentMoveChoices } from "./types";

export async function getRetainedBookingOfferings(
  database: typeof db,
  params: {
    shopId: string;
    retained: {
      serviceId: string;
      serviceName: string;
      servicePriceUsd: string;
      serviceDurationMinutes: number;
    };
  },
): Promise<Pick<OwnerAppointmentMoveChoices, "barbers" | "services">> {
  const barberRows = await database
    .select({ id: barbers.id, name: barbers.name })
    .from(barbers)
    .where(and(eq(barbers.shopId, params.shopId), eq(barbers.archived, false)));

  const serviceRows = await database
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
        eq(services.shopId, params.shopId),
        eq(services.archived, false),
        or(
          eq(services.offered, true),
          eq(services.id, params.retained.serviceId),
        ),
      ),
    )
    .orderBy(asc(services.name), asc(services.id));

  const eligibleBarberIds = new Set(barberRows.map((barber) => barber.id));
  const grouped = new Map<
    string,
    OwnerAppointmentMoveChoices["services"][number]
  >();
  for (const row of serviceRows) {
    if (!eligibleBarberIds.has(row.barberId)) continue;
    const isRetainedService = row.id === params.retained.serviceId;
    const offering = grouped.get(row.id) ?? {
      id: row.id,
      name: isRetainedService ? params.retained.serviceName : row.name,
      priceUsd: isRetainedService
        ? params.retained.servicePriceUsd
        : row.priceUsd,
      durationMinutes: isRetainedService
        ? params.retained.serviceDurationMinutes
        : Number(row.durationMinutes),
      barberIds: [],
      hidden: !row.offered,
    };
    offering.barberIds.push(row.barberId);
    grouped.set(row.id, offering);
  }

  return { barbers: barberRows, services: [...grouped.values()] };
}
