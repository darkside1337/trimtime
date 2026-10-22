import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  OwnerPageFooter,
  OwnerPageHeader,
} from "@/components/owner-page-header";
import { OwnerManagementNav } from "@/components/owner-management-nav";
import { OwnerSignOut } from "@/components/owner-auth-controls";
import { BarberManagement } from "@/features/barbers/components/barber-management";
import { getOwnBarbers } from "@/features/barbers/queries";
import { getOwnServices } from "@/features/catalog/queries";
import { getOwnShop } from "@/features/shops/queries";
import { readOwnerContext } from "@/server/owner-context";

export default function BarbersPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <BarbersContent />
    </Suspense>
  );
}

async function BarbersContent() {
  const context = await readOwnerContext(await headers());
  if (!context) redirect("/sign-in");
  const shop = await getOwnShop(context);
  if (!shop) redirect("/setup");
  const [barbers, services] = await Promise.all([
    getOwnBarbers(context),
    getOwnServices(context),
  ]);
  return (
    <div className="flex min-h-dvh flex-col">
      <OwnerPageHeader>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <OwnerManagementNav current="barbers" />
          <OwnerSignOut />
        </div>
      </OwnerPageHeader>
      <main className="mx-auto w-full max-w-[1176px] flex-1 px-5 py-10 sm:px-7 sm:py-14">
        <p className="mb-4 text-xs font-bold tracking-[0.14em] text-[var(--success)]">
          {shop.name}
        </p>
        <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">
          Barbers
        </h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Manage profiles and choose which services each barber can provide.
        </p>
        <BarberManagement barbers={barbers ?? []} services={services ?? []} />
      </main>
      <OwnerPageFooter />
    </div>
  );
}
