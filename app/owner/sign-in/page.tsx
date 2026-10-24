import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import {
  OwnerPageFooter,
  OwnerPageHeader,
} from "@/components/owner-page-header";
import { OwnerAuthControls } from "@/components/owner-auth-controls";
import { getOwnShop } from "@/features/shops/queries";
import { readOwnerContext } from "@/server/owner-context";
type SignInProps = { searchParams: Promise<{ error?: string | string[] }> };

export default function SignInPage({ searchParams }: SignInProps) {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <SignInContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SignInContent({ searchParams }: SignInProps) {
  const requestHeaders = await headers();
  const context = await readOwnerContext(requestHeaders);
  if (context) redirect((await getOwnShop(context)) ? "/" : "/setup");
  const providerFailed = Boolean((await searchParams).error);
  return (
    <>
      <a className="owner-skip" href="#sign-in-heading">
        Skip to sign in
      </a>
      <OwnerPageHeader
        homeHref={process.env.MARKETING_ORIGIN ?? "http://localhost:3100"}
      >
        <Link
          className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
          href={process.env.MARKETING_ORIGIN ?? "http://localhost:3100"}
        >
          Back to site
        </Link>
      </OwnerPageHeader>
      <main className="owner-sign-in mx-auto grid w-full max-w-[1176px] flex-1 items-center gap-10 px-5 pt-8 pb-14 md:grid-cols-[minmax(0,1.03fr)_minmax(0,0.97fr)] md:gap-[clamp(48px,7vw,104px)] md:px-7 md:pt-12 md:pb-20">
        <section aria-labelledby="welcome-heading">
          <p className="text-[13px] font-bold tracking-[0.12em] text-[var(--success)]">
            TRIMTIME FOR OWNERS
          </p>
          <h1
            id="welcome-heading"
            className="mt-6 max-w-[13ch] font-heading text-[clamp(44px,11vw,56px)] leading-[1.08] font-bold tracking-[-0.04em] md:max-w-[10ch] md:text-[clamp(48px,5vw,72px)]"
          >
            Make room for the whole day.
          </h1>
          <p className="mt-4 max-w-[43ch] text-base leading-[1.65] text-muted-foreground md:mt-6 md:text-[17px]">
            Sign in to reach your shop calendar, keep barber schedules current,
            and see every appointment in one place.
          </p>
          <div className="mt-6 mb-6 h-1 md:mt-10 md:mb-10 w-[72px] rounded-full bg-[var(--mint)]" />
          <ol className="grid gap-4">
            {[
              ["Already have a shop?", "Return straight to your shop."],
              ["New to TrimTime?", "Set up one private shop."],
            ].map(([title, detail], index) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                  {index + 1}
                </span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="text-[15px] text-muted-foreground">{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section
          aria-labelledby="sign-in-heading"
          className="grid w-full gap-6 rounded-xl border border-border bg-muted px-6 py-8 md:max-w-[472px] md:justify-self-end md:p-12"
        >
          <span className="w-fit rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold">
            Owner access
          </span>
          <div>
            <h2
              id="sign-in-heading"
              tabIndex={-1}
              className="font-heading text-[clamp(32px,3vw,40px)] leading-[1.2] font-bold tracking-[-0.04em]"
            >
              Welcome in.
            </h2>
            <p className="mt-3 text-base text-muted-foreground">
              Continue with Google, then return to your shop.
            </p>
          </div>
          <OwnerAuthControls providerFailed={providerFailed} />
          <p className="text-[13px] leading-[1.55] text-muted-foreground">
            TrimTime is a fictional barber-booking portfolio demo. Use fictional
            shop details.
          </p>
          <div className="border-t border-border pt-8">
            <h3 className="font-semibold">Booking as a customer?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Customers book from a shop’s booking page without signing in.
            </p>
          </div>
        </section>
      </main>
      <OwnerPageFooter />
    </>
  );
}
