"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Barlow_Condensed } from "next/font/google";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ManagedBookingView } from "../types";
import { customerEmailStatusCopy } from "@/features/notifications/customer-summary";
import { shop as styles } from "./shop-styles";

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: "700",
  variable: "--font-shop-display",
  display: "swap",
});

const sampleServices = ["Classic cut", "Beard tidy", "Cut & beard"];
const sampleBarbers = ["Amal", "Youssef", "Leila"];
const sampleTimes = [
  "9:00 AM",
  "9:15 AM",
  "9:30 AM",
  "9:45 AM",
  "10:00 AM",
  "10:15 AM",
  "10:30 AM",
  "10:45 AM",
  "11:00 AM",
  "11:15 AM",
  "11:30 AM",
  "11:45 AM",
];

type PreviewScreen = "details" | "edit";
type PreviewDialog = "cancel" | "discard" | null;

function appointmentTime(booking: ManagedBookingView) {
  const dateTime = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: booking.shop.timeZone,
  })
    .formatToParts(new Date(booking.startAt))
    .reduce<Record<string, string>>((parts, part) => {
      if (part.type !== "literal") parts[part.type] = part.value;
      return parts;
    }, {});
  const date = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: booking.shop.timeZone,
  });
  const time = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: booking.shop.timeZone,
  });
  return {
    date: date.format(new Date(booking.startAt)),
    dateTime: `${dateTime.year}-${dateTime.month}-${dateTime.day}`,
    range: `${time.format(new Date(booking.startAt))} – ${time.format(new Date(booking.endAt))}`,
  };
}

function SiteHeader({
  name,
  publicContact,
}: {
  name: string;
  publicContact?: string;
}) {
  return (
    <header
      className={cn(
        styles.wrap,
        "flex min-h-[92px] items-center justify-between gap-6 border-b border-[#242424] py-3 max-[767px]:min-h-[84px] max-[767px]:gap-3",
      )}
    >
      <Link className={styles.wordmark} href="/" aria-label={name}>
        {name}
        <span className={styles.greenDot}>.</span>
      </Link>
      <nav aria-label="Shop navigation" className={styles.siteNav}>
        <Link href="/">Back to the shop</Link>
        {publicContact ? <span>{publicContact}</span> : null}
      </nav>
    </header>
  );
}

function Footer({ name }: { name: string }) {
  return (
    <footer
      className={`${styles.footer} ${styles.wrap} mt-20 border-t border-[#e6e6e2]`}
    >
      <span className={styles.footerWordmark}>
        {name}
        <span className={styles.greenDot}>.</span>
      </span>
      <p className={styles.footerNote}>
        Your booking link is private. Keep it that way.
      </p>
    </footer>
  );
}

function Hero() {
  return (
    <section
      className={cn(
        styles.wrap,
        "flex items-end justify-between gap-8 py-12 max-[767px]:flex-col max-[767px]:items-start max-[767px]:gap-5 max-[767px]:py-8",
      )}
    >
      <h1 className="font-[family-name:var(--font-shop-display)] text-[88px] font-bold uppercase leading-[0.95] tracking-[-0.025em] max-[1024px]:text-[72px] max-[767px]:text-[48px]">
        Your chair.
        <br />
        Your plans<span className={styles.greenDot}>.</span>
      </h1>
      <p className="max-w-[26ch] text-sm leading-[1.8] text-[#72726e]">
        A fresh time, a change of plans.
        <br />
        Take care of it here.
      </p>
    </section>
  );
}

function Dialogs({
  booking,
  dialog,
  onOpenChange,
  onDiscard,
}: {
  booking: ManagedBookingView;
  dialog: PreviewDialog;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}) {
  const isCancel = dialog === "cancel";
  const current = appointmentTime(booking);
  return (
    <Dialog open={dialog !== null} onOpenChange={onOpenChange}>
      <DialogContent className={cn(display.variable, "[--radius-pill:2px]")}>
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-shop-display)] text-3xl font-bold uppercase">
            {isCancel ? "Let this chair go?" : "Keep your original?"}
          </DialogTitle>
          <DialogDescription>
            {isCancel
              ? "Preview only. This appointment will not be cancelled."
              : "Your original appointment is still reserved. Leave without saving these preview choices?"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1 bg-[#f7f7f5] p-4 text-sm">
          <p>
            {booking.service.name} with {booking.barber.name}
          </p>
          <p>
            {current.date} · {current.range}
          </p>
          <p className="text-xs text-[#72726e]">
            Preview only · no appointment data will change
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isCancel ? "Keep appointment" : "Keep editing"}
          </Button>
          {isCancel ? (
            <Button disabled variant="destructive">
              Yes, cancel appointment · Unavailable
            </Button>
          ) : (
            <Button onClick={onDiscard}>Discard preview choices</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppointmentSummary({
  booking,
  title,
  className,
}: {
  booking: ManagedBookingView;
  title: string;
  className?: string;
}) {
  const { date, range } = appointmentTime(booking);
  return (
    <section
      className={cn("min-w-0 border-t border-[#242424] py-4", className)}
    >
      <h2 className="font-[family-name:var(--font-shop-display)] text-[30px] font-bold leading-tight">
        {title}
      </h2>
      <dl className="mt-4 grid gap-4 text-sm">
        <div>
          <dt className="text-xs text-[#72726e]">Service</dt>
          <dd>
            {booking.service.name} · {booking.service.durationMinutes} minutes
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[#72726e]">Barber</dt>
          <dd>{booking.barber.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#72726e]">Date and time</dt>
          <dd>
            {date}, {range}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[#72726e]">Total · USD</dt>
          <dd>
            ${Number(booking.service.priceUsd).toFixed(2)} · Pay at the shop
          </dd>
        </div>
      </dl>
    </section>
  );
}

function BookingPreview({
  booking,
  onClose,
  headingRef,
}: {
  booking: ManagedBookingView;
  onClose: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const original = appointmentTime(booking);
  const [service, setService] = useState(booking.service.name);
  const [barber, setBarber] = useState(booking.barber.name);
  const [date, setDate] = useState(original.dateTime);
  const [time, setTime] = useState("");
  const [screen, setScreen] = useState<"edit" | "review">("edit");
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    (screen === "review" ? reviewHeadingRef : headingRef).current?.focus();
  }, [screen, headingRef]);

  const options = (items: string[], current: string) =>
    Array.from(new Set([current, ...items]));

  if (screen === "review") {
    return (
      <section className="border-t-[3px] border-[#242424] pt-7">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#72726e]">
            Preview only · no booking changes are saved
          </p>
          <Button variant="link" onClick={() => setScreen("edit")}>
            Back to choices
          </Button>
        </div>
        <h2
          className="font-[family-name:var(--font-shop-display)] text-[clamp(36px,5vw,52px)] font-bold uppercase leading-none"
          ref={reviewHeadingRef}
          tabIndex={-1}
        >
          A quick look before we change it.
        </h2>
        <p className="mt-3 text-sm text-[#72726e]">
          Your original appointment stays reserved. These sample choices are
          shown only to demonstrate the review screen.
        </p>
        <div className="mt-7 grid gap-6 md:grid-cols-2">
          <AppointmentSummary booking={booking} title="Currently booked" />
          <section className="border-t border-[#242424] bg-[#f7f7f5] p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#72726e]">
              Sample preview values · not a live offer
            </p>
            <h3 className="mt-2 font-[family-name:var(--font-shop-display)] text-[30px] font-bold leading-tight">
              Your new appointment
            </h3>
            <dl className="mt-4 grid gap-4 text-sm">
              <div>
                <dt className="text-xs text-[#72726e]">Service</dt>
                <dd>{service}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#72726e]">Barber</dt>
                <dd>{barber}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#72726e]">Date and time</dt>
                <dd>
                  {date} · {time}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#72726e]">Price</dt>
                <dd>Sample only · pay at the shop</dd>
              </div>
            </dl>
          </section>
        </div>
        <p className="mt-5 text-sm">
          {booking.shop.timeZone}. Your contact details and private booking link
          stay the same.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
          <Button variant="link" onClick={onClose}>
            Back to your booking
          </Button>
          <Button className="max-w-full whitespace-normal text-center" disabled>
            Confirm appointment change · Unavailable
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="border-t-[3px] border-[#242424] pt-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#72726e]">
          Preview only · choices stay in this browser view
        </p>
        <Button variant="link" onClick={onClose}>
          Back to your booking
        </Button>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            className="font-[family-name:var(--font-shop-display)] text-[clamp(36px,5vw,52px)] font-bold uppercase leading-none"
            ref={headingRef}
            tabIndex={-1}
          >
            A fresh time. Your call.
          </h2>
          <p className="mt-3 text-sm text-[#72726e]">
            Your original chair stays reserved. Review sample choices; no
            booking change can be saved.
          </p>
        </div>
        <Button variant="link" onClick={onClose}>
          Keep original
        </Button>
      </div>
      <p className="mt-5 border border-[#e6e6e2] bg-[#f7f7f5] p-3 text-xs text-[#72726e]">
        Sample options demonstrate the future screen. They are not shop
        availability and cannot change this booking.
      </p>
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid min-w-0 gap-7">
          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold">
              1. Choose your service
            </legend>
            {options(sampleServices, booking.service.name).map(
              (item, index) => (
                <label
                  className={cn(
                    "flex min-h-[72px] cursor-pointer items-center gap-4 border border-[#e6e6e2] px-4 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#21734f]",
                    service === item && "border-[#21734f] bg-[#f7f7f5]",
                  )}
                  key={item}
                >
                  <input
                    checked={service === item}
                    name="preview-service"
                    onChange={() => setService(item)}
                    type="radio"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{item}</span>
                    <span className="text-xs text-[#72726e]">
                      {item === booking.service.name
                        ? "Your current service"
                        : "Sample preview choice"}
                    </span>
                  </span>
                  <span className="text-right text-sm text-[#72726e]">
                    {index === 0 && item === booking.service.name
                      ? `$${Number(booking.service.priceUsd).toFixed(2)}`
                      : "Sample price"}
                  </span>
                </label>
              ),
            )}
          </fieldset>
          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold">
              2. Choose your barber
            </legend>
            {options(sampleBarbers, booking.barber.name).map((item) => (
              <label
                className={cn(
                  "flex min-h-[64px] cursor-pointer items-center gap-4 border border-[#e6e6e2] px-4 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#21734f]",
                  barber === item && "border-[#21734f] bg-[#f7f7f5]",
                )}
                key={item}
              >
                <input
                  checked={barber === item}
                  name="preview-barber"
                  onChange={() => setBarber(item)}
                  type="radio"
                />
                <span>{item}</span>
              </label>
            ))}
          </fieldset>
          <label
            className="grid max-w-lg gap-2 text-sm font-semibold"
            htmlFor="preview-date"
          >
            3. Choose a date · sample only
            <input
              className="min-h-11 rounded-[2px] border border-[#e6e6e2] px-3 font-normal"
              id="preview-date"
              onChange={(event) => setDate(event.target.value)}
              type="date"
              value={date}
            />
          </label>
          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold">
              4. Choose a start time · sample only
            </legend>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {sampleTimes.map((item) => (
                <label
                  className={cn(
                    "grid min-h-11 cursor-pointer place-items-center border border-[#e6e6e2] px-2 text-center text-xs",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#21734f]",
                    time === item && "border-[#21734f] bg-[#21734f] text-white",
                  )}
                  key={item}
                >
                  <input
                    checked={time === item}
                    className="sr-only"
                    name="preview-time"
                    onChange={() => setTime(item)}
                    type="radio"
                  />
                  {item}
                </label>
              ))}
            </div>
          </fieldset>
          <Button disabled={!date || !time} onClick={() => setScreen("review")}>
            Review change · Preview only
          </Button>
        </div>
        <aside className="h-fit bg-[#f7f7f5] p-5">
          <p className="text-xs font-semibold">
            Your original chair · still reserved
          </p>
          <p className="mt-5">{booking.service.name}</p>
          <p>{booking.barber.name}</p>
          <p className="mt-3">{original.date}</p>
          <p>{original.range}</p>
          <p className="mt-4 text-xs text-[#72726e]">
            Nothing changes unless a later release supports a confirmed update.
          </p>
        </aside>
      </div>
    </section>
  );
}

export function ManageBooking({
  booking,
  past,
}: {
  booking: ManagedBookingView;
  past: boolean;
}) {
  const { date, range } = appointmentTime(booking);
  const router = useRouter();
  const cancelled = booking.status === "cancelled";
  const viewOnly = cancelled || past;
  const heading = cancelled
    ? "Cancelled"
    : past
      ? "Past, unmarked"
      : "Confirmed";
  const [screen, setScreen] = useState<PreviewScreen>("details");
  const [dialog, setDialog] = useState<PreviewDialog>(null);
  const [refreshingStatus, startRefresh] = useTransition();
  const [refreshRequested, setRefreshRequested] = useState(false);
  const screenHeadingRef = useRef<HTMLHeadingElement>(null);

  function refreshMessageStatus() {
    if (refreshingStatus) return;
    setRefreshRequested(true);
    startRefresh(() => router.refresh());
  }

  useEffect(() => {
    if (screen === "details")
      screenHeadingRef.current?.focus({ preventScroll: true });
  }, [screen]);

  return (
    <main
      className={cn(
        styles.page,
        display.variable,
        "[--primary:#21734f] [--primary-foreground:#fff] [--radius-pill:2px]",
      )}
    >
      <div className={styles.noticeBar}>
        <span>Fictional shop · Real attention to detail</span>
        <span>Your booking details are private</span>
      </div>
      <SiteHeader
        name={booking.shop.name}
        publicContact={booking.shop.publicContact}
      />
      <Hero />

      <div
        className={cn(
          styles.wrap,
          screen === "details" && styles.bookingLayout,
        )}
      >
        <section className="min-w-0 border-t-[3px] border-[#242424]">
          {screen === "details" ? (
            <>
              <div className="flex min-h-[70px] items-center justify-between gap-4 border-b border-[#e6e6e2] text-xs">
                <p className="font-semibold" role="status">
                  <span aria-hidden="true" className="mr-3 text-[#21734f]">
                    {viewOnly ? "○" : "✓"}
                  </span>
                  {heading}
                </p>
                <span className="text-[#72726e]">Your appointment</span>
              </div>
              <div className="border-b border-[#e6e6e2] py-8">
                <h2
                  className="font-[family-name:var(--font-shop-display)] text-[clamp(38px,5vw,52px)] font-bold leading-none tracking-[-0.02em] max-[767px]:text-[36px] focus:outline-none"
                  ref={screenHeadingRef}
                  tabIndex={-1}
                >
                  {date}
                </h2>
                <p className="mt-4 text-2xl">{range}</p>
                <p className="mt-1 text-xs text-[#72726e]">
                  {booking.shop.timeZone}
                </p>
                <div className="mt-7 flex flex-wrap items-center justify-between gap-4 max-[767px]:grid max-[767px]:grid-cols-2">
                  {!viewOnly && !booking.changeCutoffPassed ? (
                    <Button
                      className="max-[767px]:whitespace-normal"
                      variant="link"
                      onClick={() => setDialog("cancel")}
                    >
                      Preview cancellation
                    </Button>
                  ) : null}
                  <Button
                    className="max-[767px]:order-3 max-[767px]:col-span-2 max-[767px]:justify-self-start"
                    disabled
                    variant="link"
                  >
                    Add to calendar · Unavailable
                  </Button>
                  {!viewOnly && !booking.changeCutoffPassed ? (
                    <Button
                      className="max-[767px]:order-2 max-[767px]:whitespace-normal"
                      onClick={() => setScreen("edit")}
                    >
                      Open change preview
                    </Button>
                  ) : null}
                </div>
                <p className="mt-3 text-xs text-[#72726e]">
                  {cancelled
                    ? "This appointment was cancelled."
                    : past
                      ? "This appointment is past and unmarked."
                      : booking.changeCutoffPassed
                        ? `Online changes are not available within 12 hours of your start. Contact ${booking.shop.publicContact}.`
                        : "Online changes are not available yet. Contact the shop if your plans change."}
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-x-8 gap-y-7 border-b border-[#e6e6e2] py-7 max-[767px]:gap-x-4">
                <div className="grid gap-1">
                  <dt className="text-xs text-[#72726e]">Service</dt>
                  <dd className="font-[family-name:var(--font-shop-display)] text-[32px] leading-tight">
                    {booking.service.name}
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-xs text-[#72726e]">Your barber</dt>
                  <dd className="font-[family-name:var(--font-shop-display)] text-[32px] leading-tight">
                    {booking.barber.name}
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-xs text-[#72726e]">Reserved for</dt>
                  <dd>{booking.customer.name}</dd>
                  <dd className="wrap-anywhere text-xs">
                    {booking.customer.email ?? "No email provided"}
                  </dd>
                  {booking.customer.phone ? (
                    <dd className="text-xs">{booking.customer.phone}</dd>
                  ) : null}
                </div>
                <div className="grid gap-1">
                  <dt className="text-xs text-[#72726e]">Duration</dt>
                  <dd>{booking.service.durationMinutes} minutes</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-xs text-[#72726e]">Total · USD</dt>
                  <dd className="font-[family-name:var(--font-shop-display)] text-[32px] leading-tight">
                    ${Number(booking.service.priceUsd).toFixed(2)}
                  </dd>
                  <dd className="text-xs text-[#72726e]">Pay at the shop</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-xs text-[#72726e]">Where</dt>
                  <dd>{booking.shop.name}</dd>
                  <dd className="text-xs text-[#72726e]">
                    {booking.shop.address}
                  </dd>
                </div>
              </dl>

              <div className="mt-6 bg-[#f7f7f5] p-6 text-[13px] leading-relaxed">
                <p className="font-semibold">
                  {cancelled
                    ? "Your appointment is cancelled."
                    : past
                      ? "This appointment is past and unmarked."
                      : booking.changeCutoffPassed
                        ? "Online changes are closed."
                        : "Room for a change of plans."}
                </p>
                <p className="mt-2">
                  {viewOnly
                    ? "Keep these details for your records. Contact the shop if you need help."
                    : booking.changeCutoffPassed
                      ? "Your appointment starts within 12 hours. Contact the shop if your plans change."
                      : "Customer changes are not available yet. Contact the shop if your plans change."}
                </p>
                <p className="mt-2 text-[#72726e]" role="status">
                  {customerEmailStatusCopy(booking.notifications.email)}
                </p>
                <Button
                  aria-busy={refreshingStatus}
                  aria-disabled={refreshingStatus}
                  className="mt-3 aria-disabled:opacity-50"
                  onClick={refreshMessageStatus}
                  variant="outline"
                >
                  {refreshingStatus
                    ? "Refreshing status…"
                    : "Refresh message status"}
                </Button>
                <p aria-live="polite" className="sr-only" role="status">
                  {refreshRequested
                    ? refreshingStatus
                      ? "Refreshing message status."
                      : "Refresh request finished. Check the message status above."
                    : ""}
                </p>
              </div>
            </>
          ) : (
            <BookingPreview
              booking={booking}
              headingRef={screenHeadingRef}
              onClose={() => setDialog("discard")}
            />
          )}
        </section>

        {screen === "details" ? (
          <aside className="self-start border-t-[3px] border-[#242424] bg-[#f7f7f5] p-[22px] max-[767px]:mt-2">
            <h2 className="font-[family-name:var(--font-shop-display)] text-[32px] font-bold uppercase leading-none">
              The same good place.
            </h2>
            <p className="mt-5 font-[family-name:var(--font-shop-display)] text-[30px] font-bold">
              {booking.shop.name}
            </p>
            <p className="mt-1 text-sm">{booking.shop.address}</p>
            <p className="mt-6 text-sm">{booking.shop.publicContact}</p>
            <div className="mt-6 border-t border-[#e6e6e2] pt-5 text-xs">
              <p className="font-semibold">Need a hand?</p>
              <p className="mt-2 text-[#72726e]">
                Contact the shop for help with your booking or contact details.
              </p>
            </div>
          </aside>
        ) : null}
      </div>

      <Footer name={booking.shop.name} />
      <Dialogs
        booking={booking}
        dialog={dialog}
        onOpenChange={(open) => setDialog(open ? dialog : null)}
        onDiscard={() => {
          setDialog(null);
          setScreen("details");
        }}
      />
    </main>
  );
}

export function UnavailableManageBooking() {
  return (
    <main
      className={cn(
        styles.page,
        display.variable,
        "[--primary:#21734f] [--primary-foreground:#fff] [--radius-pill:2px]",
      )}
    >
      <div className={styles.noticeBar}>
        <span>Fictional shop · Real attention to detail</span>
        <span>Private booking link</span>
      </div>
      <SiteHeader name="TrimTime" />
      <Hero />
      <section
        className={`${styles.wrap} border-t-[3px] border-[#242424] py-10`}
      >
        <h2 className={styles.displayHeading}>Booking link unavailable</h2>
        <p className="mt-5 max-w-2xl text-[#72726e]">
          This link may be missing, invalid, expired, or unavailable. No booking
          details can be shown.
        </p>
        <Button className="mt-7" render={<Link href="/" />} variant="outline">
          Back to the shop
        </Button>
      </section>
      <footer
        className={`${styles.footer} ${styles.wrap} mt-20 border-t border-[#e6e6e2]`}
      >
        <span className={styles.footerWordmark}>
          TrimTime<span className={styles.greenDot}>.</span>
        </span>
        <p className={styles.footerNote}>Keep private booking links private.</p>
      </footer>
    </main>
  );
}
