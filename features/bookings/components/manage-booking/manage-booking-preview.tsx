"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ManagedBookingView } from "../../types";
import { appointmentTime } from "./appointment-time";

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

export function BookingPreview({
  booking,
  onClose,
  headingRef,
}: {
  booking: ManagedBookingView;
  onClose: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
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
