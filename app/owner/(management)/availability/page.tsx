import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AvailabilityManagement } from "@/features/availability/components/availability-management";
import {
  getOwnAvailabilityOverview,
  getOwnSchedules,
} from "@/features/availability/queries";
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
  const [availability, overview, shop] = await Promise.all([
    getOwnSchedules(context),
    getOwnAvailabilityOverview(context),
    getOwnShop(context),
  ]);
  if (!availability || !overview || !shop) redirect("/setup");
  return (
    <main className="mr-auto w-full max-w-[1120px] flex-1 px-5 py-5 min-[901px]:px-9 min-[901px]:pt-7 min-[901px]:pb-12">
      <p className="mb-2 mt-8 text-xs font-bold tracking-[0.14em] text-[var(--success)]">
        OWNER SCHEDULING · {availability.timeZone}
      </p>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Shop and barber availability
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Set weekly shop hours, independent barber schedules, and date-specific
        changes for {shop.name}. Bookable times use the overlap of both
        schedules in {availability.timeZone}.
      </p>
      <AvailabilityManagement
        initial={availability}
        initialOverview={overview}
      />
    </main>
  );
}
