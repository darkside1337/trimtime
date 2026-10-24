import { headers } from "next/headers";
import { Suspense } from "react";
import {
  getPublicShop,
  previewPublicSlots,
} from "@/features/shops/public-queries";
import { PublicAvailabilityPreview } from "@/features/shops/components/public-availability-preview";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function PublicShopPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <PublicShopContent searchParams={searchParams} />
    </Suspense>
  );
}

async function PublicShopContent({ searchParams }: { searchParams: Search }) {
  const [requestHeaders, params] = await Promise.all([headers(), searchParams]);
  const shop = await getPublicShop(requestHeaders);
  if (!shop)
    return (
      <main className="mx-auto grid min-h-dvh max-w-3xl content-center gap-4 px-6">
        <h1 className="font-heading text-4xl font-bold">
          Shop page unavailable
        </h1>
        <p>Check the address and try again.</p>
      </main>
    );
  if (shop.status === "paused")
    return (
      <main className="mx-auto grid min-h-dvh max-w-3xl content-center gap-6 px-6 py-16">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          TrimTime · Fictional demo
        </p>
        <h1 className="font-heading text-5xl font-bold">{shop.name}</h1>
        <p className="text-xl">
          This shop is paused and isn’t accepting booking requests.
        </p>
        <section className="grid gap-2 rounded-xl border p-6">
          <h2 className="font-heading text-xl font-semibold">Contact</h2>
          <p>{shop.publicContact}</p>
          <p className="text-sm text-muted-foreground">
            Shop time zone: {shop.timeZone}
          </p>
        </section>
        <p className="text-sm text-muted-foreground">
          TrimTime is a fictional portfolio demo. No booking is created from
          this page.
        </p>
      </main>
    );

  const services = shop.services;
  const requestedService = one(params.serviceId);
  const invalidService = Boolean(
    requestedService && !services.some((item) => item.id === requestedService),
  );
  const service =
    services.find((item) => item.id === requestedService) ?? services[0];
  const requestedBarber = one(params.barberId);
  const barbers = service?.barbers ?? [];
  const invalidBarber = Boolean(
    requestedBarber && !barbers.some((item) => item.id === requestedBarber),
  );
  const barber =
    barbers.find((item) => item.id === requestedBarber) ?? barbers[0];
  const date = one(params.date) ?? "";
  const dateIsValid =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  const preview =
    dateIsValid && service && barber && !invalidService && !invalidBarber
      ? await previewPublicSlots(requestHeaders, {
          serviceId: service.id,
          barberId: barber.id,
          date,
        })
      : null;
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-10 px-5 py-10 sm:px-8 sm:py-16">
      <header className="grid gap-4 border-b pb-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          TrimTime · Fictional demo
        </p>
        <h1 className="font-heading text-5xl font-bold tracking-tight sm:text-6xl">
          {shop.name}
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Explore services and preview available starts. No account is needed to
          view this page.
        </p>
        <p className="text-sm">
          {shop.address} · {shop.publicContact} · Shop time zone:{" "}
          {shop.timeZone}
        </p>
      </header>
      <section className="grid gap-5" aria-labelledby="services-heading">
        <h2 id="services-heading" className="font-heading text-3xl font-bold">
          Services
        </h2>
        {!services.length ? (
          <p className="rounded-xl bg-muted p-6">
            No services are currently offered.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {services.map((item) => (
              <article
                key={item.id}
                className="grid gap-2 rounded-xl border p-5"
              >
                <h3 className="font-heading text-xl font-semibold">
                  {item.name}
                </h3>
                <p>
                  {money.format(Number(item.priceUsd))} · {item.durationMinutes}{" "}
                  minutes
                </p>
                <p className="text-sm text-muted-foreground">
                  {item.barbers.map(({ name }) => name).join(", ") ||
                    "No active barber is currently assigned."}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="grid gap-5" aria-labelledby="preview-heading">
        <div>
          <h2 id="preview-heading" className="font-heading text-3xl font-bold">
            Availability preview
          </h2>
          <p className="mt-2 text-muted-foreground">
            Booking submission is not available yet. A preview does not hold a
            start.
          </p>
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid gap-5">
            {services.length > 0 && (
              <PublicAvailabilityPreview
                services={services}
                initialServiceId={service?.id}
                initialBarberId={barber?.id}
                date={dateIsValid ? date : ""}
              />
            )}
            {invalidService || invalidBarber ? (
              <p role="alert" className="rounded-xl border p-5">
                That selection is no longer available. Choose the service and
                barber again.
              </p>
            ) : !date ? (
              <p className="rounded-xl border p-5">
                Choose a date to preview eligible starts.
              </p>
            ) : !dateIsValid ? (
              <p role="alert" className="rounded-xl border p-5">
                Choose a valid date.
              </p>
            ) : !service || !barber ? (
              <p className="rounded-xl border p-5">
                Choose a service with an active barber to preview starts.
              </p>
            ) : !preview ? (
              <p role="status" className="rounded-xl border p-5">
                That selection is no longer available. Choose the service and
                barber again.
              </p>
            ) : preview.slots.length ? (
              <ul
                aria-label="Eligible starts"
                className="grid gap-2 sm:grid-cols-3"
              >
                {preview.slots.map((slot) => (
                  <li key={slot.start} className="rounded-lg border p-4">
                    <time dateTime={slot.start}>
                      {slot.localStart} {slot.offset}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border p-5">
                No eligible starts are available on this date.
              </p>
            )}
          </div>
          <aside
            className="grid gap-4 rounded-xl border-t-4 border-foreground bg-muted p-5"
            aria-label="Preview selection summary"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Preview selection
              </p>
              <h3 className="mt-3 font-heading text-2xl font-bold">
                {shop.name}
              </h3>
            </div>
            <dl className="grid gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Service</dt>
                <dd className="text-right">
                  {service?.name ?? "Choose a service"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Barber</dt>
                <dd className="text-right">
                  {barber?.name ?? "Choose a barber"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Date</dt>
                <dd className="text-right">
                  {dateIsValid ? date : "Choose a date"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Time zone</dt>
                <dd className="text-right">{shop.timeZone}</dd>
              </div>
            </dl>
            <p className="border-t pt-4 text-sm text-muted-foreground">
              Availability is informational. No start is held and no appointment
              is created.
            </p>
          </aside>
        </div>
      </section>
      <footer className="mt-auto border-t pt-6 text-sm text-muted-foreground">
        Fictional portfolio demo · Availability is informational and no
        appointment is created.
      </footer>
    </main>
  );
}

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
