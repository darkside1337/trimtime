import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SettingsForm } from "@/features/shops/components/settings-form";
import { getOwnShop } from "@/features/shops/queries";
import { readOwnerContext } from "@/server/owner-context";
import Link from "next/link";
import { OwnerPageFooter, OwnerPageHeader } from "@/components/owner-page-header";
export default function SettingsPage() { return <Suspense fallback={<main className="min-h-dvh" />}><SettingsContent /></Suspense>; }
async function SettingsContent() {
  const requestHeaders = await headers();
  const context = await readOwnerContext(requestHeaders);
  if (!context) redirect("/sign-in");
  const shop = await getOwnShop(context);
  if (!shop) redirect("/setup");
  return <><OwnerPageHeader><Link href="/" className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">Back to Today</Link></OwnerPageHeader>
    <main className="mx-auto flex-1 w-full max-w-[1176px] px-5 py-10 sm:px-7 sm:py-14">
      <p className="mb-5 text-xs font-bold tracking-[0.14em] text-[var(--success)]">OWNER SETTINGS</p>
      <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">Settings</h1>
      <p className="mt-5 text-muted-foreground">Manage the basics of your unpublished shop.</p>
      <p className="mt-5 w-fit rounded-full bg-secondary px-3 py-1.5 text-xs font-medium">Unpublished draft</p>
      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-xl border border-border p-6 sm:p-8"><h2 className="mb-7 font-heading text-2xl font-bold">Shop details</h2><SettingsForm shop={shop} /></section>
        <aside className="rounded-xl border border-border bg-muted p-6 sm:p-7"><p className="w-fit rounded-full bg-secondary px-3 py-2 text-xs font-medium">Unpublished draft</p><h2 className="mt-6 font-heading text-xl font-bold">Your shop, your details.</h2><p className="mt-4 text-muted-foreground">The subdomain and address stay read-only here. Your time zone can change until the first appointment is created.</p><p className="mt-5 text-sm text-muted-foreground">Saving settings does not publish your shop.</p></aside>
      </div>
    </main><OwnerPageFooter /></>;
}
