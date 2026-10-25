import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import Image from "next/image";
import { Barlow_Condensed } from "next/font/google";
import { BookingFlow } from "@/features/bookings/components/booking-flow";
import { getPublicShop } from "@/features/shops/public-queries";
import type { WeeklySchedule } from "@/features/availability/types";
import { shop as styles } from "@/features/bookings/components/shop-styles";

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: "700",
  variable: "--font-shop-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Book an appointment",
  description: "Choose a barber and a time at your local shop.",
};

export default function PublicShopPage() {
  return (
    <Suspense
      fallback={
        <main
          className={`${styles.page} ${display.variable}`}
          aria-busy="true"
        />
      }
    >
      <PublicShopContent />
    </Suspense>
  );
}

async function PublicShopContent() {
  const shop = await getPublicShop(await headers());
  if (!shop)
    return (
      <main className={`${styles.page} ${display.variable}`}>
        <section className={`${styles.messagePanel} ${styles.wrap}`}>
          <p className={styles.eyebrow}>TrimTime · Fictional demo</p>
          <h1 className={styles.displayHeading}>Shop page unavailable</h1>
          <p>Check the address and try again.</p>
        </section>
      </main>
    );

  return (
    <main className={`${styles.page} ${display.variable}`}>
      <div className={styles.noticeBar}>
        <span>Fictional shop · Real attention to detail</span>
        <span>Bookings are saved securely · No account needed</span>
      </div>
      <header className={`${styles.siteHeader} ${styles.wrap}`}>
        <a className={styles.wordmark} href="#top" aria-label={shop.name}>
          {shop.name}
          <span className={styles.greenDot}>.</span>
        </a>
        <nav aria-label="Shop navigation" className={styles.siteNav}>
          {shop.status === "published" ? (
            <a href="#booking">Book a chair</a>
          ) : null}
          <a href="#shop-contact">The shop</a>
          <span>{shop.publicContact}</span>
        </nav>
      </header>

      {shop.status === "paused" ? (
        <>
          <section className={`${styles.paused} ${styles.wrap}`} id="top">
            <p className={styles.eyebrow}>TrimTime · Fictional demo</p>
            <h1 className={styles.displayHeading}>
              We’re taking a booking break.
            </h1>
            <p>
              Online booking is paused. Existing appointments and their private
              links are still available.
            </p>
            <p className={styles.supporting}>
              For help, contact the shop at{" "}
              <strong>{shop.publicContact}</strong>. Shop time zone:{" "}
              {shop.timeZone}.
            </p>
          </section>
          <ShopFooter
            name={shop.name}
            publicContact={shop.publicContact}
            timeZone={shop.timeZone}
          />
        </>
      ) : (
        <>
          <section
            className={`${styles.hero} ${styles.wrap}`}
            id="top"
            aria-labelledby="shop-title"
          >
            <div className={styles.heroCopy}>
              <h1 className={styles.heroTitle} id="shop-title">
                A GOOD CUT.
                <br />
                YOUR KIND
                <br />
                OF PLACE<span className={styles.greenDot}>.</span>
              </h1>
              <p className={styles.heroText}>
                {shop.name} is your place for a good cut, a great barber, and a
                little time for yourself. Choose a service and book directly
                with the shop.
              </p>
              <a className={styles.primaryLink} href="#booking">
                Book an appointment <span aria-hidden="true">↗</span>
              </a>
              <p className={styles.addressLine}>{shop.address}</p>
            </div>
            <figure className={styles.heroPhoto}>
              {/* This is the approved Doop photo, copied locally for production use. */}
              <Image
                src="/brand/barbershop.jpg"
                alt="A barber shaving a reclining customer"
                width={1600}
                height={1067}
                sizes="(max-width: 767px) calc(100vw - 40px), (max-width: 1024px) calc((100vw - 64px) / 2), 640px"
                preload
                className={styles.heroImage}
              />
              <figcaption className={styles.heroPhotoCaption}>
                <span>The chair is yours.</span>
                <span>Illustrative barbershop photography</span>
              </figcaption>
            </figure>
          </section>
          <div className={styles.promiseBar}>
            <strong>Cuts. Beards. Good company.</strong>
            <span>Choose your barber</span>
            <span>No account needed</span>
            <span>Pay at the shop</span>
          </div>
          <section
            className={`${styles.bookingSection} ${styles.wrap}`}
            id="booking"
          >
            <header className={styles.bookingIntro}>
              <div>
                <h2 className={styles.displayHeading}>
                  Make time for a fresh start.
                </h2>
                <p>Your cut. Your barber. Your time.</p>
              </div>
              <p className={styles.disclosure}>
                All prices in USD
                <br />
                All times in {shop.timeZone}
              </p>
            </header>
            <BookingFlow
              services={shop.services}
              shopName={shop.name}
              publicContact={shop.publicContact}
              timeZone={shop.timeZone}
            />
          </section>
          <ShopFooter
            name={shop.name}
            address={shop.address}
            publicContact={shop.publicContact}
            timeZone={shop.timeZone}
            recurringHours={shop.recurringHours}
          />
        </>
      )}
    </main>
  );
}

function ShopFooter({
  name,
  address,
  publicContact,
  timeZone,
  recurringHours,
}: {
  name: string;
  address?: string;
  publicContact: string;
  timeZone: string;
  recurringHours?: WeeklySchedule | null;
}) {
  const weekdays = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  const formatMinute = (minute: number) => {
    if (minute === 1440) return "12:00 AM";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(Date.UTC(1970, 0, 1, 0, minute)));
  };
  const openWindows = (day: WeeklySchedule[number]) => {
    return day.working.flatMap((range) => {
      let windows = [range];
      for (const pause of day.breaks) {
        windows = windows.flatMap((window) => {
          if (pause.end <= window.start || pause.start >= window.end)
            return [window];
          return [
            ...(pause.start > window.start
              ? [{ start: window.start, end: pause.start }]
              : []),
            ...(pause.end < window.end
              ? [{ start: pause.end, end: window.end }]
              : []),
          ];
        });
      }
      return windows;
    });
  };
  return (
    <>
      <section className={styles.footerCallout} id="shop-contact">
        <h2 className={styles.footerCalloutTitle}>
          See you
          <br />
          in the chair.
        </h2>
        <div>
          <h3 className={styles.footerInfoTitle}>Find {name}</h3>
          {address ? <p>{address}</p> : null}
          <p>{publicContact}</p>
          <p className={styles.supporting}>Shop time zone: {timeZone}</p>
          {recurringHours ? (
            <details className="mt-6 max-w-xl border-y border-[#e6e6e2] py-4 text-sm">
              <summary className="cursor-pointer font-semibold">
                Recurring shop hours
              </summary>
              <p className="my-3 text-xs text-[#72726e]">
                Recurring hours after breaks, in {timeZone}. Date-specific
                exceptions may apply.
              </p>
              <dl className="grid gap-2 text-xs">
                {recurringHours.map((day, index) => (
                  <div
                    key={weekdays[index]}
                    className="grid grid-cols-[6rem_1fr] gap-3"
                  >
                    <dt className="text-[#72726e]">{weekdays[index]}</dt>
                    <dd className="m-0">
                      {openWindows(day).length
                        ? openWindows(day)
                            .map(
                              (range) =>
                                `${formatMinute(range.start)}–${formatMinute(range.end)}`,
                            )
                            .join(", ")
                        : "Closed"}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}
        </div>
      </section>
      <footer className={`${styles.footer} ${styles.wrap}`}>
        <span className={styles.footerWordmark}>
          {name}
          <span className={styles.greenDot}>.</span>
        </span>
        <a
          href={new URL(
            "/sign-in",
            process.env.APP_ORIGIN ?? "http://app.localhost:3100",
          ).toString()}
          className={styles.signInLink}
        >
          Owner sign in
        </a>
      </footer>
    </>
  );
}
