"use client";

import { useMemo, useState } from "react";
import { Clock3, Mail, MessageCircle } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DesignPreviewNotice } from "./design-preview-notice";
import type { ShopView } from "../queries";

const c = {
  workspace:
    "mx-auto flex w-full min-w-0 max-w-[1480px] flex-[1_0_auto] flex-col gap-4 px-7 py-6 max-[520px]:gap-3",
  activityWorkspace:
    "max-w-[1180px] gap-5 max-[900px]:max-w-[760px] max-[520px]:gap-4",
  activityHeader:
    "grid gap-2 [&>h1]:font-heading [&>h1]:text-[clamp(24px,3vw,32px)] [&>h1]:font-bold [&>h1]:tracking-[-.03em] [&>p]:max-w-[80ch] [&>p]:text-sm [&>p]:leading-[1.45] [&>p]:text-[var(--muted-foreground)]",
  eyebrowRow:
    "flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[.08em] text-[var(--muted-foreground)]",
  tzBadge:
    "inline-flex items-center rounded-full border border-border bg-[var(--surface)] px-[9px] py-[3px] normal-case tracking-normal",
  sampleBadge:
    "inline-flex items-center rounded-full border border-border bg-secondary px-[9px] py-[3px] normal-case tracking-normal text-secondary-foreground",
  stats: "grid grid-cols-3 gap-3.5 max-[900px]:grid-cols-1",
  statCard:
    "grid min-w-0 gap-2 rounded-[var(--radius)] border border-border bg-[var(--surface)] p-4 [&>span]:text-[10px] [&>span]:font-bold [&>span]:uppercase [&>span]:tracking-[.08em] [&>span]:text-[var(--muted-foreground)] [&>strong]:font-heading [&>strong]:text-2xl [&>strong]:font-bold [&>strong]:leading-[1.2] [&>strong]:tracking-[-.03em] [&>p]:text-[11px] [&>p]:leading-[1.4] [&>p]:text-[var(--muted-foreground)] [&>small]:text-[11px] [&>small]:leading-[1.4] [&>small]:text-[var(--muted-foreground)]",
  progress:
    "h-[5px] overflow-hidden rounded-full bg-border [&>span]:block [&>span]:h-full [&>span]:w-[28%] [&>span]:rounded-full [&>span]:bg-foreground",
  activityTools:
    "grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-[var(--radius)] border border-border p-3 max-[520px]:flex max-[520px]:flex-col max-[520px]:items-stretch",
  tabs: "col-start-1 row-start-1 flex min-w-0 flex-wrap items-center gap-2 max-[520px]:grid max-[520px]:w-full max-[520px]:grid-cols-2 [&>button]:min-h-10 [&>button]:rounded-full [&>button]:text-xs max-[520px]:[&>button]:min-w-0 max-[520px]:[&>button]:px-1 max-[520px]:[&>button]:py-1.5 max-[520px]:[&>button]:text-[10px] [&_button_span]:rounded-full [&_button_span]:bg-secondary [&_button_span]:px-[5px] [&_button_span]:text-[10px]",
  filterLine:
    "col-span-full flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5 max-[520px]:flex-col max-[520px]:items-stretch [&>input]:w-full [&>input]:max-w-[320px] max-[520px]:[&>input]:max-w-full",
  channels:
    "flex min-w-0 flex-wrap items-center justify-end gap-2 max-[520px]:justify-start [&>span]:text-[11px] [&>span]:text-[var(--muted-foreground)] [&>button]:min-h-9 [&>button]:rounded-full [&>button]:px-2.5 [&>button]:text-[11px] max-[520px]:[&>button]:px-2",
  eventGroups: "grid gap-[22px]",
  eventGroup:
    "grid gap-2 [&>header]:flex [&>header]:justify-between [&>header]:gap-3 [&>header]:px-1 [&>header>h2]:text-xs [&>header>h2]:font-bold [&>header>h2]:uppercase [&>header>h2]:tracking-[.06em] [&>header>h2]:text-[var(--muted-foreground)] [&>header>span]:text-[11px] [&>header>span]:text-[var(--muted-foreground)]",
  activityEvent:
    "grid grid-cols-[34px_minmax(0,1fr)_auto_auto] items-start gap-3 rounded-[var(--radius)] border border-border p-3 max-[900px]:grid-cols-[34px_minmax(0,1fr)_auto] max-[520px]:grid-cols-[30px_minmax(0,1fr)] max-[520px]:gap-2 max-[520px]:p-2.5",
  eventIcon:
    "grid size-8 place-items-center rounded-[10px] border border-border bg-secondary text-base max-[520px]:size-[30px]",
  eventCopy:
    "grid min-w-0 gap-[3px] [&>h3]:text-[13px] [&>h3]:font-semibold [&>h3]:leading-[1.4] [&>h3>span]:ml-[3px] [&>h3>span]:rounded-[5px] [&>h3>span]:bg-[var(--surface)] [&>h3>span]:px-[5px] [&>h3>span]:py-0.5 [&>h3>span]:text-[10px] [&>h3>span]:font-medium [&>h3>span]:text-[var(--muted-foreground)] [&>p]:text-xs [&>p]:leading-[1.4] [&>p]:text-[var(--muted-foreground)] [&>small]:mt-[3px] [&>small]:text-[10px] [&>small]:leading-[1.4] [&>small]:text-[var(--muted-foreground)] max-[520px]:[&>h3]:text-xs max-[520px]:[&>p]:text-[11px] max-[520px]:[&>small]:text-[9px]",
  eventStatus:
    "justify-self-end whitespace-nowrap rounded-full bg-secondary px-2 py-1 text-[10px] font-bold max-[520px]:col-start-2 max-[520px]:justify-self-start",
  eventActions:
    "flex flex-wrap justify-end gap-1.5 max-[900px]:col-start-2 max-[900px]:col-end-[-1] max-[900px]:justify-start max-[520px]:col-start-2 [&>button]:min-h-9 [&>button]:rounded-full [&>button]:px-2.5 [&>button]:text-[10px] max-[520px]:[&>button]:px-2",
  retention:
    "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[var(--radius)] border border-border bg-[var(--surface)] px-4 py-3.5 max-[520px]:items-start max-[520px]:flex-col [&>strong]:text-xs [&>p]:max-w-[80ch] [&>p]:text-[11px] [&>p]:text-[var(--muted-foreground)] [&>span]:shrink-0 [&>span]:rounded-full [&>span]:bg-background [&>span]:px-[9px] [&>span]:py-[5px] [&>span]:text-[10px] [&>span]:text-[var(--muted-foreground)]",
  noMatches:
    "rounded-[var(--radius)] border border-border p-7 text-center text-[var(--muted-foreground)]",
  details:
    "m-0 grid grid-cols-2 gap-2.5 max-[520px]:grid-cols-1 [&>div]:min-w-0 [&>div]:rounded-[var(--radius-control)] [&>div]:bg-[var(--surface)] [&>div]:px-3 [&>div]:py-2.5 [&_dt]:text-[11px] [&_dt]:text-[var(--muted-foreground)] [&_dd]:mt-1 [&_dd]:text-[13px] [&_dd]:font-semibold [&_dd]:[overflow-wrap:anywhere]",
  payload:
    "col-span-full [&_code]:font-mono [&_code]:text-[11px] [&_code]:font-normal [&_code]:[overflow-wrap:anywhere] max-[520px]:[grid-column:auto]",
};

type EventSample = {
  id: string;
  group: "Upcoming reminders" | "Today" | "Yesterday";
  category: "Customer messages" | "Owner audit" | "Issues & retries";
  channel: "Email" | "WhatsApp (test recipient)" | "System";
  title: string;
  detail: string;
  status: string;
  time: string;
  person: string;
  source: string;
  contact?: string;
  retry?: boolean;
};

const events: EventSample[] = [
  {
    id: "a6",
    group: "Upcoming reminders",
    category: "Customer messages",
    channel: "Email",
    title: "Reminder scheduled for dispatch",
    detail:
      "Example reminder row. No message is scheduled or sent by this preview.",
    status: "Sample · queued",
    time: "Tomorrow at 11:00",
    person: "Samir Bensaid (Amal)",
    source: "Automated reminder example",
    retry: true,
  },
  {
    id: "a5",
    group: "Today",
    category: "Customer messages",
    channel: "Email",
    title: "Booking confirmation · email example",
    detail:
      "Example outcome: accepted. This does not show a real provider response.",
    status: "Sample · accepted",
    time: "Today at 15:00",
    person: "Maya Rahal (Youssef)",
    source: "Customer booking example",
    contact: "maya@example.test",
  },
  {
    id: "batch",
    group: "Today",
    category: "Customer messages",
    channel: "Email",
    title: "Shop address update notice · example",
    detail:
      "Example broadcast row. The preview does not look up customers or send notices.",
    status: "Sample · 6 of 6",
    time: "Today at 14:15",
    person: "6 future bookings (all barbers)",
    source: "Shop settings example",
  },
  {
    id: "a4",
    group: "Today",
    category: "Owner audit",
    channel: "System",
    title: "Walk-in booking without customer contact",
    detail: "Example owner calendar entry. No booking was created.",
    status: "Sample · no contact",
    time: "Today at 10:00",
    person: "Rami Saadi (Leila)",
    source: "Owner calendar example",
  },
  {
    id: "a3",
    group: "Today",
    category: "Customer messages",
    channel: "Email",
    title: "Booking confirmation · email example",
    detail: "Example outcome: accepted. No email was sent.",
    status: "Sample · accepted",
    time: "Today at 10:00",
    person: "Sofia Merabet (Youssef)",
    source: "Customer booking example",
  },
  {
    id: "a2",
    group: "Today",
    category: "Customer messages",
    channel: "WhatsApp (test recipient)",
    title: "Booking confirmation · WhatsApp example",
    detail:
      "Example restricted test-recipient outcome. No WhatsApp message was sent.",
    status: "Sample · accepted",
    time: "Today at 10:00",
    person: "Karim Haddad (Amal)",
    source: "Customer booking example with consent",
  },
  {
    id: "a1",
    group: "Today",
    category: "Customer messages",
    channel: "Email",
    title: "Booking confirmation and reminder · example",
    detail:
      "Example outcome: accepted. The preview does not contact a customer.",
    status: "Sample · accepted",
    time: "Today at 09:00",
    person: "Nadia Benali (Amal)",
    source: "Customer booking example",
    contact: "nadia@example.test",
  },
  {
    id: "a10",
    group: "Yesterday",
    category: "Owner audit",
    channel: "System",
    title: "Attendance marked · no-show example",
    detail: "Example activity row. No attendance record was changed.",
    status: "Sample · audit",
    time: "Yesterday at 16:00",
    person: "Adel Boumaza (Leila)",
    source: "Owner attendance example",
  },
  {
    id: "a7",
    group: "Yesterday",
    category: "Customer messages",
    channel: "Email",
    title: "Customer cancellation · owner alert example",
    detail:
      "Example cancellation and email outcome. No booking changed and no alert was sent.",
    status: "Sample · accepted",
    time: "Yesterday at 14:00",
    person: "Lina Bouzid (Leila)",
    source: "Customer self-service example",
  },
  {
    id: "a9",
    group: "Yesterday",
    category: "Owner audit",
    channel: "System",
    title: "Attendance marked · completed example",
    detail: "Example activity row. No attendance record was changed.",
    status: "Sample · audit",
    time: "Yesterday at 14:00",
    person: "Sara Mansouri (Amal)",
    source: "Owner attendance example",
  },
  {
    id: "a11",
    group: "Yesterday",
    category: "Issues & retries",
    channel: "Email",
    title: "Temporary provider issue · retry example",
    detail:
      "Example retry status. No provider was called and no retry was queued.",
    status: "Sample · retry queued",
    time: "Yesterday at 11:30",
    person: "David K. (Youssef)",
    source: "Rescheduling notification example",
    retry: true,
  },
];

const categories = [
  "All events",
  "Customer messages",
  "Owner audit",
  "Issues & retries",
] as const;
const channels = [
  "All",
  "Email",
  "WhatsApp (test recipient)",
  "System",
] as const;

function matchesCategory(event: EventSample, selected: string) {
  return (
    selected === "All events" ||
    (selected === "Customer messages" &&
      (event.category === selected || event.retry)) ||
    (selected === "Issues & retries" && Boolean(event.retry)) ||
    event.category === selected
  );
}

export function OwnerActivity({ shop }: { shop: ShopView }) {
  const [category, setCategory] =
    useState<(typeof categories)[number]>("All events");
  const [channel, setChannel] = useState<(typeof channels)[number]>("All");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{
    event?: EventSample;
    mode: "details" | "payload" | "resend" | "export";
  } | null>(null);
  const filtered = useMemo(
    () =>
      events.filter(
        (event) =>
          matchesCategory(event, category) &&
          (channel === "All" || event.channel === channel) &&
          `${event.title} ${event.person} ${event.contact ?? ""} ${event.id} ${event.detail}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [category, channel, search],
  );
  const counts = (value: string) =>
    events.filter((event) => matchesCategory(event, value)).length;

  return (
    <main className={`${c.workspace} ${c.activityWorkspace}`}>
      <header className={c.activityHeader}>
        <div className={c.eyebrowRow}>
          <span>{shop.name} · owner audit</span>
          <span className={c.tzBadge}>{shop.timeZone}</span>
          <span className={c.tzBadge}>
            {shop.published ? "Published" : "Unpublished"}
          </span>
          <span className={c.sampleBadge}>Sample activity</span>
        </div>
        <h1>Booking activity &amp; message status</h1>
        <p>
          Booking changes, reminder examples, and email or restricted WhatsApp
          outcomes.
        </p>
      </header>
      <DesignPreviewNotice kind="activity" />
      <section className={c.stats} aria-label="Sample activity metrics">
        <article className={c.statCard}>
          <span>Sample daily outbound budget</span>
          <strong>28 / 100</strong>
          <div className={c.progress}>
            <span />
          </div>
          <p>
            Example attempt count against the shared 100-attempt limit. No
            attempts occurred.
          </p>
        </article>
        <article className={c.statCard}>
          <span>Sample reminder pipeline</span>
          <strong>3 queued</strong>
          <p>Example rows: 1 upcoming · 1 suppressed · 1 later</p>
          <small>No reminder is queued by this preview.</small>
        </article>
        <article className={c.statCard}>
          <span>Sample delivery outcomes</span>
          <strong>96.4% accepted</strong>
          <p>Example aggregate only; it does not describe actual sends.</p>
          <small>
            Email examples · restricted WhatsApp test-recipient example
          </small>
        </article>
      </section>
      <section className={c.activityTools} aria-label="Activity filters">
        <div className={c.tabs} role="group" aria-label="Activity type">
          {categories.map((item) => (
            <Button
              key={item}
              variant={category === item ? "secondary" : "ghost"}
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
            >
              {item} <span>{counts(item)}</span>
            </Button>
          ))}
        </div>
        <Button variant="outline" onClick={() => setDialog({ mode: "export" })}>
          Export log
        </Button>
        <div className={c.filterLine}>
          <Input
            aria-label="Search activity"
            placeholder="Filter by customer, ID, email, or barber…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className={c.channels} role="group" aria-label="Channel filter">
            <span>Channel:</span>
            {channels.map((item) => (
              <Button
                key={item}
                variant={channel === item ? "default" : "outline"}
                aria-pressed={channel === item}
                onClick={() => setChannel(item)}
              >
                {item}
              </Button>
            ))}
          </div>
        </div>
      </section>
      <div className={c.eventGroups} aria-live="polite">
        {["Upcoming reminders", "Today", "Yesterday"].map((group) => {
          const rows = filtered.filter((event) => event.group === group);
          if (!rows.length) return null;
          return (
            <section key={group} className={c.eventGroup}>
              <header>
                <h2>{group}</h2>
                <span>
                  {rows.length} {rows.length === 1 ? "event" : "events"}
                </span>
              </header>
              {rows.map((event) => (
                <article className={c.activityEvent} key={event.id}>
                  <span className={c.eventIcon} aria-hidden="true">
                    {event.channel === "System" ? (
                      <Clock3 className="size-4" />
                    ) : event.channel.startsWith("WhatsApp") ? (
                      <MessageCircle className="size-4" />
                    ) : (
                      <Mail className="size-4" />
                    )}
                  </span>
                  <div className={c.eventCopy}>
                    <h3>
                      {event.title} <span>#{event.id}</span>
                    </h3>
                    <p>{event.detail}</p>
                    <small>
                      {event.time} · {event.person} · {event.source}
                    </small>
                  </div>
                  <span className={c.eventStatus}>{event.status}</span>
                  <div className={c.eventActions}>
                    <Button
                      variant="outline"
                      onClick={() => setDialog({ event, mode: "payload" })}
                    >
                      Show payload
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setDialog({ event, mode: "details" })}
                    >
                      Event details
                    </Button>
                    {event.category === "Customer messages" && (
                      <Button
                        variant="outline"
                        onClick={() => setDialog({ event, mode: "resend" })}
                      >
                        Preview resend
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
        {!filtered.length && (
          <p className={c.noMatches}>No sample events match these filters.</p>
        )}
      </div>
      <aside className={c.retention}>
        <strong>Activity and retention</strong>
        <p>
          Real booking and activity records follow the approved 30-day retention
          requirement. This sample list is not stored and is not evidence of a
          cleanup run.
        </p>
        <span>Policy reference · preview only</span>
      </aside>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === "resend"
                ? "Resend preview"
                : dialog?.mode === "export"
                  ? "Export preview"
                  : dialog?.mode === "payload"
                    ? "Sample payload"
                    : "Sample event details"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.mode === "resend"
                ? "Preview only. No provider is called and no message is sent."
                : dialog?.mode === "export"
                  ? "The activity export is shown as a design preview; no file was generated."
                  : "Illustrative sample data. This is not a real booking or provider outcome."}
            </DialogDescription>
          </DialogHeader>
          {dialog?.event && (
            <dl className={c.details}>
              <div>
                <dt>Event</dt>
                <dd>{dialog.event.title}</dd>
              </div>
              <div>
                <dt>Example record</dt>
                <dd>#{dialog.event.id}</dd>
              </div>
              <div>
                <dt>Sample outcome</dt>
                <dd>{dialog.event.status}</dd>
              </div>
              <div>
                <dt>Channel</dt>
                <dd>{dialog.event.channel}</dd>
              </div>
              <div>
                <dt>Sample contact</dt>
                <dd>{dialog.event.contact ?? "No sample contact"}</dd>
              </div>
              {dialog.mode === "payload" && (
                <div className={c.payload}>
                  <dt>Example payload</dt>
                  <dd>
                    <code>
                      {JSON.stringify({
                        sample: true,
                        event: dialog.event.id,
                        channel: dialog.event.channel,
                        outcome: dialog.event.status,
                      })}
                    </code>
                  </dd>
                </div>
              )}
              {dialog.mode === "resend" && (
                <div className={c.payload}>
                  <dt>Recipient</dt>
                  <dd>Sample recipient · not contacted</dd>
                </div>
              )}
            </dl>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Close
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
