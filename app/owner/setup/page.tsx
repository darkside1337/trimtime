import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SetupForm } from "@/features/shops/components/setup-form";
import { getOwnShop } from "@/features/shops/queries";
import { readOwnerContext } from "@/server/owner-context";
import {
  OwnerPageFooter,
  OwnerPageHeader,
} from "@/components/owner-page-header";
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
  const publicOrigin = new URL(
    process.env.MARKETING_ORIGIN ?? "http://localhost:3100",
  ).origin;

  return (
    <>
      <OwnerPageHeader>
        <OwnerSignOut />
      </OwnerPageHeader>
      <main className="mx-auto w-full max-w-[1176px] flex-1 px-5 py-10 sm:px-7 sm:py-14">
        <div className="max-w-3xl">
          <p className="mb-4 text-xs font-bold tracking-[0.14em] text-[var(--success)]">
            STEP 1 OF 4 · SHOP DETAILS
          </p>
          <h1 className="font-heading text-[clamp(40px,4.5vw,60px)] leading-[1.12] font-bold tracking-tight">
            Set up your shop.
          </h1>
          <p className="mt-4 max-w-[60ch] text-muted-foreground">
            Start with the essentials. Your shop stays private until its
            services, barbers, and working hours are ready.
          </p>
          <p className="mt-5 inline-flex rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold">
            Design preview · use fictional shop details
          </p>
        </div>
        <div className="mt-8 min-[901px]:mt-12">
          <SetupForm
            publicOrigin={publicOrigin}
            readiness={
              <aside
                className="rounded-2xl border border-border bg-muted p-6 sm:p-7"
                aria-labelledby="readiness-heading"
              >
                <h2
                  id="readiness-heading"
                  className="font-heading text-xl font-bold"
                >
                  Before you publish
                </h2>
                <p className="mt-2 text-muted-foreground">
                  Creating a shop is the first step. Public booking stays off
                  until the shop is ready.
                </p>
                <p className="mt-5 w-fit rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold">
                  Unpublished draft
                </p>
                <ul className="mt-5 divide-y divide-border border-t border-border">
                  <li className="py-3">
                    <h3 className="text-sm font-semibold">Shop details</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Name, address, contact, time zone, and subdomain
                    </p>
                  </li>
                  <li className="py-3">
                    <h3 className="text-sm font-semibold">Services</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Add at least one active service
                    </p>
                  </li>
                  <li className="py-3">
                    <h3 className="text-sm font-semibold">Barber profiles</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Assign an active barber to that service
                    </p>
                  </li>
                  <li className="py-3 last:pb-0">
                    <h3 className="text-sm font-semibold">Working hours</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Set usable shop and barber hours
                    </p>
                  </li>
                </ul>
              </aside>
            }
          />
        </div>
      </main>
      <OwnerPageFooter />
    </>
  );
}
