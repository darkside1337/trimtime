import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AvailabilityManagement } from "@/features/availability/components/availability-management";
import { DateAvailabilityManagement } from "@/features/availability/components/date-availability-management";
import { getOwnSchedules } from "@/features/availability/queries";
import { getOwnShop } from "@/features/shops/queries";
import { readOwnerContext } from "@/server/owner-context";

export default function AvailabilityPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <AvailabilityContent />
    </Suspense>
  );
}

async function AvailabilityContent() {
  const context = await readOwnerContext(await headers());
  if (!context) redirect("/sign-in");
  const [availability, shop] = await Promise.all([
    getOwnSchedules(context),
    getOwnShop(context),
  ]);
  if (!availability || !shop) redirect("/setup");
  return (
    <main className="mx-auto w-full max-w-[1176px] flex-1 px-5 py-10 sm:px-7 sm:py-14">
      <p className="mb-5 text-xs font-bold tracking-[0.14em] text-[var(--success)]">
        OWNER AVAILABILITY
      </p>
      <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">
        Availability
      </h1>
      <p className="mt-5 max-w-2xl text-muted-foreground">
        Set recurring shop hours and barber preferences. Bookable times use the
        overlap of both schedules in{" "}
        <span className="font-medium text-foreground">
          {availability.timeZone}
        </span>
        .
      </p>
      <AvailabilityManagement initial={availability} />
      <DateAvailabilityManagement initial={availability} />
    </main>
  );
}
