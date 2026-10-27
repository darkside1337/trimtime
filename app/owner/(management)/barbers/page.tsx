import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BarberManagement } from "@/features/barbers/components/barber-management";
import { getOwnSchedules } from "@/features/availability/queries";
import { getOwnBarbers } from "@/features/barbers/queries";
import { getOwnServices } from "@/features/catalog/queries";
import { getOwnShop } from "@/features/shops/queries";
import { DesignPreviewNotice } from "@/features/shops/components/design-preview-notice";
import { readOwnerContext } from "@/server/owner-context";

export default function BarbersPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <BarbersContent />
    </Suspense>
  );
}

async function BarbersContent() {
  await connection();
  const context = await readOwnerContext(await headers());
  if (!context) redirect("/sign-in");
  const shop = await getOwnShop(context);
  if (!shop) redirect("/setup");
  const [barbers, services, availability] = await Promise.all([
    getOwnBarbers(context),
    getOwnServices(context),
    getOwnSchedules(context),
  ]);
  if (!availability) redirect("/setup");
  return (
    <main className="mr-auto w-full max-w-[1120px] flex-1 px-5 py-5 min-[901px]:px-9 min-[901px]:pt-7 min-[901px]:pb-12">
      <DesignPreviewNotice kind="barbers" />
      <p className="mb-2 mt-8 text-xs font-bold tracking-[0.14em] text-[var(--success)]">
        OWNER TEAM
      </p>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Barber profiles and service assignments
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Manage barbers at {shop.name}, their sample active status, and the
        services each barber is qualified to perform. Barbers do not have
        separate staff logins or independent access.
      </p>
      <BarberManagement
        barbers={barbers ?? []}
        services={services ?? []}
        schedules={availability.barbers}
        timeZone={availability.timeZone}
      />
    </main>
  );
}
