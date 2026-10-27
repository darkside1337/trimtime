import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Globe2, Clock3, LockKeyhole } from "lucide-react";
import { SettingsForm } from "@/features/shops/components/settings-form";
import { PublicationControls } from "@/features/shops/components/publication-controls";
import {
  getOwnPublicationReadiness,
  getOwnShop,
  getOwnSettingsDetails,
} from "@/features/shops/queries";
import { ShopSharing } from "@/features/shops/components/shop-sharing";
import { createShopQrSvg, getCanonicalShopUrl } from "@/features/shops/sharing";
import { readOwnerContext } from "@/server/owner-context";
export default function SettingsPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <SettingsContent />
    </Suspense>
  );
}
async function SettingsContent() {
  await connection();
  const requestHeaders = await headers();
  const context = await readOwnerContext(requestHeaders);
  if (!context) redirect("/sign-in");
  const shop = await getOwnShop(context);
  if (!shop) redirect("/setup");
  const readiness = await getOwnPublicationReadiness(context);
  if (!readiness) redirect("/setup");
  const details = await getOwnSettingsDetails(context);
  if (!details) redirect("/setup");
  const timeZoneLocked = Boolean(details.timeZoneLockedAt);
  const canonicalUrl = getCanonicalShopUrl(shop.subdomain);
  let qrData = "";
  try {
    qrData = `data:image/svg+xml;base64,${Buffer.from(await createShopQrSvg(shop.subdomain)).toString("base64")}`;
  } catch {
    // The canonical link remains usable if QR generation is unavailable.
  }
  return (
    <main className="owner-settings w-full max-w-[1120px] flex-1 px-5 py-7 min-[901px]:px-9">
      <header className="mb-6 grid gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
          <span className="uppercase tracking-widest text-[var(--success)]">
            Owner settings
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1">
            <Clock3 className="size-3" aria-hidden="true" />
            {shop.timeZone}
          </span>
          <span
            className={
              shop.published
                ? "rounded-full bg-[var(--success-surface)] px-2 py-1 text-[var(--success)]"
                : "rounded-full bg-[var(--warning-surface)] px-2 py-1 text-[var(--warning)]"
            }
          >
            {shop.published ? "Published" : "Unpublished draft"}
          </span>
        </div>
        <h1 className="font-heading text-[28px] leading-tight font-bold tracking-tight sm:text-[32px]">
          Shop settings &amp; public link
        </h1>
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          Manage {shop.name} details, publication status, your permanent public
          link, and scannable QR code.
        </p>
      </header>
      <div
        className="mb-6 grid gap-3 sm:grid-cols-2"
        aria-label="Shop settings summary"
      >
        <div className="flex items-start justify-between gap-4 rounded-[var(--radius)] border border-border bg-muted p-4">
          <div className="grid gap-1">
            <span className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
              Publication
            </span>
            <strong className="font-heading text-xl">
              {shop.published ? "Published" : "Unpublished"}
            </strong>
            <span className="text-xs text-muted-foreground">
              {shop.published
                ? "Public availability preview is live"
                : "Public shop page is paused"}
            </span>
          </div>
          <Globe2
            className="size-5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
        <div className="flex items-start justify-between gap-4 rounded-[var(--radius)] border border-border bg-muted p-4">
          <div className="grid gap-1">
            <span className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
              Time zone
            </span>
            <strong className="font-heading text-xl">
              {timeZoneLocked ? "Permanently locked" : "Editable"}
            </strong>
            <span className="text-xs text-muted-foreground">
              {timeZoneLocked
                ? "First appointment recorded"
                : "Can change before the first appointment"}
            </span>
          </div>
          <LockKeyhole
            className="size-5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      </div>
      <SettingsForm
        shop={shop}
        timeZoneLocked={timeZoneLocked}
        owner={details}
        publication={
          <PublicationControls
            published={shop.published}
            readiness={readiness}
          />
        }
        sharing={
          <ShopSharing
            url={canonicalUrl}
            qrData={qrData}
            qrAvailable={Boolean(qrData)}
            shopName={shop.name}
            address={shop.address}
          />
        }
      />
    </main>
  );
}
