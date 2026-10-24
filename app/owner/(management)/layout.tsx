import { Suspense, type ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OwnerManagementNav } from "@/components/owner-management-nav";
import { OwnerPageFooter } from "@/components/owner-page-header";
import { getOwnShop } from "@/features/shops/queries";
import { readOwnerContext } from "@/server/owner-context";

export default async function OwnerManagementLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-background" />}>
      <OwnerManagementFrame>{children}</OwnerManagementFrame>
    </Suspense>
  );
}

async function OwnerManagementFrame({ children }: { children: ReactNode }) {
  const context = await readOwnerContext(await headers());
  if (!context) redirect("/sign-in");

  const shop = await getOwnShop(context);
  if (!shop) redirect("/setup");

  return (
    <div className="min-h-dvh min-[901px]:grid min-[901px]:grid-cols-[208px_minmax(0,1fr)]">
      <OwnerManagementNav shopName={shop.name} timeZone={shop.timeZone} />
      <div className="flex min-h-dvh min-w-0 flex-col max-[900px]:min-h-[calc(100dvh-64px)]">
        {children}
        <OwnerPageFooter />
      </div>
    </div>
  );
}
