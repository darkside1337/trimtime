import { hasUsableRecurringHours } from "@/features/availability/publication-readiness";
import type { WeeklySchedule } from "@/features/availability/types";

export const PUBLICATION_REQUIREMENTS = [
  {
    key: "shop-details",
    title: "Shop details",
    label: "shop details",
    description: "Name, address, public contact and time zone.",
  },
  {
    key: "offered-service",
    title: "Services",
    label: "an offered service",
    description: "At least one active service offered publicly.",
  },
  {
    key: "active-barber-assignment",
    title: "Staff assigned",
    label: "an active barber assigned to a service",
    description: "An active barber assigned to an offered service.",
  },
  {
    key: "shared-hours",
    title: "Usable hours",
    label: "shared recurring hours with a complete 15-minute-grid start",
    description: "A complete appointment fits the shared recurring hours.",
  },
] as const;

export type PublicationRequirementKey =
  (typeof PUBLICATION_REQUIREMENTS)[number]["key"];

export type PublicationServiceFacts = {
  durationMinutes: string;
  barberIds: readonly string[];
};

export type PublicationBarberFacts = {
  id: string;
  archived: boolean;
  week: WeeklySchedule | null;
};

export type PublicationReadinessFacts = {
  shop: { name: string; publicContact: string; address: string };
  shopWeek: WeeklySchedule | null;
  services: readonly PublicationServiceFacts[];
  barbers: readonly PublicationBarberFacts[];
};

export type PublicationReadiness = {
  ready: boolean;
  missing: PublicationRequirementKey[];
};

export function publicationRequirementLabel(key: PublicationRequirementKey) {
  return PUBLICATION_REQUIREMENTS.find(
    (requirement) => requirement.key === key,
  )!.label;
}

export function publicationRequirementLabels(
  keys: readonly PublicationRequirementKey[],
) {
  return keys.map(publicationRequirementLabel);
}

export function publicationNotReadyMessage(
  missing: readonly PublicationRequirementKey[],
) {
  return `Add ${publicationRequirementLabels(missing).join(", ")} before publishing.`;
}

export function evaluatePublicationReadiness({
  shop,
  shopWeek,
  services,
  barbers,
}: PublicationReadinessFacts): PublicationReadiness {
  const barbersById = new Map(barbers.map((barber) => [barber.id, barber]));
  const eligible = services.flatMap((service) =>
    service.barberIds
      .map((id) => barbersById.get(id))
      .filter((barber): barber is PublicationBarberFacts =>
        Boolean(barber && !barber.archived),
      )
      .map((barber) => ({ service, barber })),
  );

  const complete: Record<PublicationRequirementKey, boolean> = {
    "shop-details": [shop.name, shop.publicContact, shop.address].every(
      (value) => value.trim(),
    ),
    "offered-service": services.length > 0,
    "active-barber-assignment": eligible.length > 0,
    "shared-hours":
      shopWeek !== null &&
      eligible.some(
        ({ service, barber }) =>
          barber.week !== null &&
          hasUsableRecurringHours({
            durationMinutes: service.durationMinutes,
            shopWeek,
            barberWeek: barber.week,
          }),
      ),
  };

  const missing = PUBLICATION_REQUIREMENTS.filter(
    (requirement) => !complete[requirement.key],
  ).map((requirement) => requirement.key);
  return { ready: missing.length === 0, missing };
}
