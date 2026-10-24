import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ServiceManagement } from "@/features/catalog/components/service-management";
import { DesignPreviewNotice } from "@/features/shops/components/design-preview-notice";
import { getOwnServices } from "@/features/catalog/queries";
import { getOwnBarbers } from "@/features/barbers/queries";
import { getOwnShop } from "@/features/shops/queries";
import { readOwnerContext } from "@/server/owner-context";

export default function ServicesPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <ServicesContent />
    </Suspense>
  );
}

async function ServicesContent() {
  const context = await readOwnerContext(await headers());
  if (!context) redirect("/sign-in");
  const shop = await getOwnShop(context);
  if (!shop) redirect("/setup");
  const [services, barbers] = await Promise.all([
    getOwnServices(context),
    getOwnBarbers(context),
  ]);
  return (
    <main className="mr-auto w-full max-w-[1120px] flex-1 px-5 py-5 min-[901px]:px-9 min-[901px]:pt-7 min-[901px]:pb-12">
      <DesignPreviewNotice kind="services" />
      <p className="mb-2 mt-8 text-xs font-bold tracking-[0.14em] text-[var(--success)]">
        OWNER CATALOG
      </p>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Services management
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Manage haircut and grooming services offered at {shop.name}. Service
        duration and USD prices are shared shop-wide across all eligible
        barbers.
      </p>
      <ServiceManagement services={services ?? []} barbers={barbers ?? []} />
    </main>
  );
}
