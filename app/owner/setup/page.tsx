import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SetupForm } from "@/features/shops/components/setup-form";
import { getOwnShop } from "@/features/shops/queries";
import { readOwnerContext } from "@/server/owner-context";
import { OwnerPageFooter, OwnerPageHeader } from "@/components/owner-page-header";
import { OwnerSignOut } from "@/components/owner-auth-controls";
export default function SetupPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <SetupContent />
    </Suspense>
  );
}
async function SetupContent() {
  const requestHeaders = await headers();
  const context = await readOwnerContext(requestHeaders);
  if (!context) redirect("/sign-in");
  if (await getOwnShop(context)) redirect("/");
  return (
    <><OwnerPageHeader><OwnerSignOut /></OwnerPageHeader><main className="mx-auto flex-1 w-full max-w-[1176px] px-5 py-10 sm:px-7 sm:py-14">
      <p className="mb-5 text-xs font-bold tracking-[0.14em] text-[var(--success)]">SHOP DETAILS</p>
      <h1 className="font-heading text-[clamp(40px,4.5vw,60px)] leading-[1.12] font-bold tracking-tight">
        Create your draft shop
      </h1>
      <p className="mt-5 max-w-2xl text-muted-foreground">
        Use fictional details. You can update the shop name and public contact later. Your time zone locks when the first appointment is created.
      </p>
      <div className="mt-8 grid items-start gap-10 min-[901px]:mt-12 min-[901px]:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] min-[901px]:gap-16"><section className="min-w-0">
        <h2 className="font-heading text-2xl font-bold">Shop details</h2>
        <p className="mt-2 mb-8 text-[15px] text-muted-foreground">Fields marked * are required to create a draft.</p>
        <SetupForm />
      </section><aside className="rounded-xl border border-border bg-muted p-6 sm:p-7"><h2 className="font-heading text-xl font-bold">A private start.</h2><p className="mt-4 text-muted-foreground">Creating a draft keeps your shop details in one place. It does not open public booking.</p><p className="mt-6 w-fit rounded-full bg-secondary px-3 py-2 text-xs font-medium">Unpublished draft</p><div className="mt-6 border-t border-border pt-6"><h3 className="font-semibold">Your details, your shop</h3><p className="mt-2 text-sm text-muted-foreground">You can update your shop name and public contact later. Your time zone can change only before the first appointment.</p></div></aside></div>
    </main><OwnerPageFooter /></>
  );
}
