import Link from "next/link";
import Image from "next/image";
import { TrimTimeLogo } from "@/components/trimtime-logo";
import { MarketingBookingPreview } from "@/components/marketing-booking-preview";
import { MarketingBookingDialog } from "@/components/marketing-booking-dialog";
import { MarketingMobileMenu } from "@/components/marketing-mobile-menu";

const workflow = [
  [
    "Find the right opening",
    "See each barber’s appointments and available time together. Check the day before adding another booking.",
  ],
  [
    "Record the walk-in",
    "Add phone appointments and walk-ins yourself so they count toward the shop’s online availability.",
  ],
  [
    "Protect time away",
    "Set working hours for each barber. Block breaks and days off so customers see times the shop can offer.",
  ],
];

const questions = [
  [
    "How would I access my shop?",
    "Sign in with Google to manage one private shop and its barber profiles. Create a shop opens the owner sign-in page.",
  ],
  [
    "Does each barber need an account?",
    "No. Barber profiles are scheduling resources managed by the owner. Staff accounts and invitations are outside this demo’s scope.",
  ],
  [
    "What about walk-ins and phone bookings?",
    "Owners can add them to the calendar so online availability reflects the whole schedule. Appointments arranged outside TrimTime must be entered by the owner.",
  ],
  [
    "Can I manage more than one shop?",
    "The demo supports one shop per owner, with multiple barber profiles. Managing multiple locations is outside its scope.",
  ],
  [
    "What can I try on this page?",
    "Explore the sample calendar, view the sample services, and open these answers. The sample controls do not create appointments or send messages.",
  ],
];

function ActionLink({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "inline-flex min-h-11 items-center justify-center gap-3 rounded-full bg-foreground px-6 text-sm font-semibold text-background transition-colors hover:bg-foreground/85 focus-visible:outline-2 focus-visible:outline-offset-4"
          : "inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
      }
    >
      {children}
    </Link>
  );
}

export default function Home() {
  const ownerOrigin = process.env.APP_ORIGIN ?? "http://app.localhost:3100";
  const signInHref = new URL("/sign-in", ownerOrigin).toString();
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-4 focus:py-3 focus:text-background"
      >
        Skip to content
      </a>
      <header className="mx-auto flex min-h-20 w-full max-w-6xl items-center justify-between gap-6 px-5 md:px-7">
        <Link
          href="#main"
          aria-label="TrimTime homepage"
          className="w-32 shrink-0 md:w-36"
        >
          <TrimTimeLogo arrangement="horizontal" width={180} priority />
        </Link>
        <nav
          aria-label="Main navigation"
          className="hidden items-center gap-8 text-sm font-medium md:flex"
        >
          <Link href="#how-it-works" className="hover:underline">
            Daily schedule
          </Link>
          <Link href="#customer-booking" className="hover:underline">
            Customer booking
          </Link>
          <Link href="#faq" className="hover:underline">
            FAQs
          </Link>
          <MarketingBookingDialog className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">
            Try booking <span aria-hidden="true">→</span>
          </MarketingBookingDialog>
        </nav>
        <div className="md:hidden">
          <MarketingMobileMenu />
        </div>
      </header>
      <main id="main">
        <div className="mx-auto w-full max-w-6xl px-5 md:px-7">
          <section
            className="grid items-center gap-10 pb-14 pt-8 md:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] md:gap-12 md:py-16"
            aria-labelledby="hero-title"
          >
            <div>
              <span className="inline-flex rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
                Design preview · fictional sample data
              </span>
              <h1
                id="hero-title"
                className="mt-6 max-w-[12ch] text-balance font-heading text-[48px] leading-[1.04] font-bold tracking-[-0.045em] md:text-[44px] xl:text-[64px]"
              >
                Keep the whole shop{" "}
                <span className="block max-w-[11ch] text-[var(--success)]">
                  on schedule.
                </span>
              </h1>
              <p className="mt-5 max-w-[43ch] leading-7 text-muted-foreground">
                See who’s booked, who’s available, and where the next walk-in
                can fit. Bring every barber’s day into one shop calendar.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-5">
                <MarketingBookingDialog className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">
                  Try booking
                </MarketingBookingDialog>
                <ActionLink href={signInHref} primary>
                  Create a shop <span aria-hidden="true">→</span>
                </ActionLink>
              </div>
              <p className="mt-5 max-w-[40ch] text-xs leading-5 text-muted-foreground">
                TrimTime is a fictional barber-booking portfolio demo. Sample
                bookings below are not live appointments.
              </p>
            </div>
            <div className="relative pt-12 md:pt-16">
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 flex justify-center gap-6"
              >
                <Image
                  src="/brand/marketing/scissors.png"
                  alt=""
                  width={64}
                  height={64}
                  className="size-12 -rotate-12 object-contain sm:size-14"
                  priority
                />
                <Image
                  src="/brand/marketing/comb.png"
                  alt=""
                  width={64}
                  height={64}
                  className="size-12 rotate-12 object-contain sm:size-14"
                  priority
                />
                <Image
                  src="/brand/marketing/brush.png"
                  alt=""
                  width={64}
                  height={64}
                  className="size-12 object-contain sm:size-14"
                  priority
                />
              </div>
              <div className="rounded-2xl bg-[var(--mint)] p-3 sm:p-5">
                <div className="flex items-center justify-between px-1 pb-3 text-xs">
                  <span>One shop. Every barber.</span>
                  <span
                    aria-hidden="true"
                    className="h-2 w-4 rounded-full border border-[var(--success)]"
                  />
                </div>
                <section
                  aria-label="Illustrative calendar for a fictional barber shop"
                  className="rounded-2xl bg-background p-4 shadow-sm sm:p-5"
                >
                  <div className="flex items-start justify-between border-b border-border pb-3">
                    <div>
                      <h2 className="font-heading text-lg font-bold">
                        Sharp Cuts
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Thursday, October 15 · Eastern time
                      </p>
                    </div>
                    <span className="hidden rounded-md border border-border px-2 py-1 text-xs md:inline-flex">
                      Day view
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 pt-3 text-xs md:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)] md:gap-2">
                    <div className="hidden md:block" />
                    <div className="hidden items-center gap-1.5 border-b border-border pb-2 md:flex">
                      <span className="flex size-5 items-center justify-center rounded-full bg-[var(--mint)] text-[10px]">
                        JL
                      </span>
                      Jordan
                    </div>
                    <div className="hidden items-center gap-1.5 border-b border-border pb-2 md:flex">
                      <span className="flex size-5 items-center justify-center rounded-full bg-[var(--secondary)] text-[10px]">
                        AK
                      </span>
                      Alex
                    </div>
                    <CalendarTime>9:00 AM</CalendarTime>
                    <SampleAppointment
                      name="Chris M."
                      detail="Haircut · 9:00 AM"
                      source="Online booking"
                      assigned="Jordan"
                    />
                    <SampleAppointment
                      tone="bg-[var(--butter)]"
                      name="Taylor R."
                      detail="Haircut · 9:00 AM"
                      source="Phone booking"
                      assigned="Alex"
                    />
                    <CalendarTime>10:00 AM</CalendarTime>
                    <div className="rounded-lg border border-dashed border-[var(--success)] bg-[var(--success-surface)] p-4 text-[13px] leading-5 md:p-2 md:text-[11px] md:leading-4">
                      <strong className="text-[var(--success)]">
                        Available
                      </strong>
                      <span className="block">10:00–11:00 AM</span>
                      <span className="mt-1 block md:hidden">Jordan</span>
                    </div>
                    <div className="rounded-lg border border-dashed border-border bg-muted p-4 text-[13px] leading-5 md:p-2 md:text-[11px] md:leading-4">
                      <strong>Time blocked</strong>
                      <span className="block">10:00–11:00 AM</span>
                      <span className="mt-1 block md:hidden">Alex</span>
                    </div>
                    <CalendarTime>11:00 AM</CalendarTime>
                    <SampleAppointment
                      tone="bg-[var(--secondary)]"
                      name="Jamie D."
                      detail="Beard trim · 11:00 AM"
                      source="Walk-in"
                      assigned="Jordan"
                    />
                    <SampleAppointment
                      tone="bg-[var(--lilac)]"
                      name="Morgan K."
                      detail="Cut & beard · 11:00 AM"
                      source="Online booking"
                      assigned="Alex"
                    />
                  </div>
                  <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                    Fictional people and appointments · static preview
                  </p>
                </section>
                <p className="px-1 pt-3 text-xs">
                  Online appointments and owner-entered bookings share the same
                  view.
                </p>
              </div>
            </div>
          </section>
          <section
            id="how-it-works"
            className="grid gap-8 border-t border-border py-10 md:grid-cols-[0.9fr_1.1fr] md:py-12"
            aria-labelledby="workflow-title"
          >
            <div>
              <h2
                id="workflow-title"
                className="max-w-[16ch] font-heading text-[clamp(2rem,3vw,2.5rem)] leading-tight font-bold tracking-tight"
              >
                Handle the changes
                <br />
                that make up a day.
              </h2>
              <p className="mt-4 max-w-[42ch] text-muted-foreground">
                Keep the schedule current as customers book, call, or walk
                through the door.
              </p>
            </div>
            <div className="divide-y divide-border">
              {workflow.map(([title, detail]) => (
                <article
                  key={title}
                  className="grid gap-2 py-5 first:pt-0 last:pb-0 sm:grid-cols-[0.8fr_1.2fr] sm:gap-6"
                >
                  <h3 className="font-heading text-lg font-bold">{title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {detail}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </div>
        <section
          id="customer-booking"
          className="bg-muted py-12 md:py-16"
          aria-labelledby="customer-title"
        >
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 md:grid-cols-2 md:gap-16 md:px-7">
            <div>
              <h2
                id="customer-title"
                className="max-w-[17ch] font-heading text-[clamp(2rem,3vw,2.5rem)] leading-tight font-bold tracking-tight"
              >
                Let customers choose.
                <br />
                Keep the schedule in view.
              </h2>
              <p className="mt-5 max-w-[48ch] leading-6 text-muted-foreground">
                Share your shop’s booking page. Customers choose a service, an
                eligible barber, and an available time without creating an
                account.
              </p>
              <p className="mt-4 max-w-[48ch] leading-6 text-muted-foreground">
                Their online appointments join the same calendar you use for
                phone bookings and walk-ins.
              </p>
              <div className="mt-5">
                <MarketingBookingDialog className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">
                  Try booking <span aria-hidden="true">→</span>
                </MarketingBookingDialog>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                This preview uses fictional services and prices.
              </p>
            </div>
            <MarketingBookingPreview />
          </div>
        </section>
        <div className="mx-auto w-full max-w-6xl px-5 md:px-7">
          <section
            id="faq"
            className="grid gap-8 py-12 md:grid-cols-[0.8fr_1.2fr] md:py-16"
            aria-labelledby="faq-title"
          >
            <div>
              <h2
                id="faq-title"
                className="font-heading text-[clamp(2rem,3vw,2.5rem)] leading-tight font-bold tracking-tight"
              >
                Before you
                <br />
                set up shop.
              </h2>
              <p className="mt-4 text-muted-foreground">
                A closer look at the owner experience.
              </p>
            </div>
            <div className="divide-y divide-border border-y border-border">
              {questions.map(([question, answer]) => (
                <details key={question} className="group py-4">
                  <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">
                    <span>{question}</span>
                    <span
                      aria-hidden="true"
                      className="text-xl group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="max-w-[65ch] pt-3 text-sm leading-6 text-muted-foreground">
                    {answer}
                  </p>
                </details>
              ))}
            </div>
          </section>
          <section
            className="mb-8 flex flex-col gap-6 rounded-2xl bg-[var(--secondary)] p-6 sm:p-9 md:mb-12 md:flex-row md:items-center md:justify-between"
            aria-labelledby="closing-title"
          >
            <div>
              <h2
                id="closing-title"
                className="max-w-[18ch] font-heading text-[clamp(2rem,3vw,2.5rem)] leading-tight font-bold tracking-tight"
              >
                Give every appointment
                <br />a place in the day.
              </h2>
              <p className="mt-3 text-sm">
                Explore a shop calendar built around individual barber
                schedules.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              <MarketingBookingDialog className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">
                Try booking
              </MarketingBookingDialog>
              <ActionLink href={signInHref} primary>
                Create a shop <span aria-hidden="true">→</span>
              </ActionLink>
            </div>
          </section>
          <footer className="flex min-h-20 items-center justify-between gap-4 pb-6">
            <Link
              href="#main"
              aria-label="TrimTime back to top"
              className="w-28"
            >
              <TrimTimeLogo arrangement="horizontal" width={144} />
            </Link>
            <Link
              href="#main"
              className="text-sm font-medium underline underline-offset-4"
            >
              Back to top <span aria-hidden="true">↑</span>
            </Link>
          </footer>
        </div>
      </main>
    </>
  );
}

function CalendarTime({ children }: { children: React.ReactNode }) {
  return (
    <div className="hidden pt-2 text-[10px] text-muted-foreground md:block md:min-h-[112px] md:text-xs">
      {children}
    </div>
  );
}
function SampleAppointment({
  name,
  detail,
  source,
  assigned,
  tone = "bg-[var(--mint)]",
}: {
  name: string;
  detail: string;
  source: string;
  assigned: string;
  tone?: string;
}) {
  return (
    <div
      className={`relative flex min-w-0 items-start justify-between gap-3 rounded-lg ${tone} p-4 text-[13px] leading-5 md:p-2 md:text-[11px] md:leading-4`}
    >
      <span className="min-w-0">
        <strong className="block">{name}</strong>
        <span className="block">{detail}</span>
        <span className="block">{source}</span>
      </span>
      <span className="shrink-0 text-right md:hidden">{assigned}</span>
    </div>
  );
}
