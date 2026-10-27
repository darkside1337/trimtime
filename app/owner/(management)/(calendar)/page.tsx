import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Temporal } from "temporal-polyfill";
import { OwnerCalendar } from "@/features/bookings/components/owner-calendar";
import { getOwnAppointment, getOwnCalendar } from "@/features/bookings/queries";
import { ownerEmailStatusCopy } from "@/features/notifications/customer-summary";
import { getOwnShop } from "@/features/shops/queries";
import { readOwnerContext } from "@/server/owner-context";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function OwnerPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense
      fallback={
        <main
          role="status"
          aria-label="Loading calendar"
          className="mx-auto min-h-dvh max-w-[1480px] p-6"
        >
          <div className="h-10 w-56 animate-pulse rounded bg-muted" />
          <div className="mt-6 h-14 animate-pulse rounded-2xl bg-muted" />
          <div className="mt-4 min-h-[560px] animate-pulse rounded-2xl border border-border bg-background" />
        </main>
      }
    >
      <OwnerCalendarContent searchParams={searchParams} />
    </Suspense>
  );
}

async function OwnerCalendarContent({
  searchParams,
}: {
  searchParams: Search;
}) {
  const context = await readOwnerContext(await headers());
  if (!context) redirect("/sign-in");
  const shop = await getOwnShop(context);
  if (!shop) redirect("/setup");

  const search = await searchParams;
  const requestedDate = typeof search.date === "string" ? search.date : "";
  const date = validDate(requestedDate)
    ? requestedDate
    : localDate(shop.timeZone, new Date());
  const view = search.view === "week" ? "week" : "day";
  const requestedBarber =
    typeof search.barber === "string" && search.barber !== "all"
      ? search.barber
      : undefined;
  let created:
    { id: string; customerName: string; emailCopy: string } | undefined;
  if (typeof search.created === "string") {
    const saved = await getOwnAppointment(context, search.created);
    if (saved.success)
      created = {
        id: saved.data.id,
        customerName: saved.data.customer.name,
        emailCopy: saved.data.customer.email
          ? ownerEmailStatusCopy(saved.data.notifications.email)
          : "No email was provided; no customer confirmation was sent.",
      };
  }
  let result = await getOwnCalendar(context, {
    date,
    view,
    barberId: requestedBarber,
  });
  let barberId = requestedBarber;
  if (
    !result.success &&
    result.error.code === "VALIDATION_ERROR" &&
    requestedBarber
  ) {
    barberId = undefined;
    result = await getOwnCalendar(context, { date, view });
  }
  if (!result.success) {
    const retry = new URLSearchParams({ date, view });
    if (requestedBarber) retry.set("barber", requestedBarber);
    return (
      <main className="m-auto max-w-xl p-8" role="alert">
        <h1 className="font-heading text-2xl">Calendar unavailable</h1>
        <p className="mt-2">{result.error.message}</p>
        <a className="mt-4 inline-block underline" href={`/?${retry}`}>
          Try again
        </a>
      </main>
    );
  }
  return (
    <OwnerCalendar
      calendar={result.data}
      shopName={shop.name}
      published={shop.published}
      date={date}
      view={view}
      barberId={barberId}
      created={created}
      now={new Date().toISOString()}
    />
  );
}

function localDate(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}-${parts.find((part) => part.type === "day")!.value}`;
}

function validDate(value: string) {
  try {
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Temporal.PlainDate.from(value).toString() === value
    );
  } catch {
    return false;
  }
}
