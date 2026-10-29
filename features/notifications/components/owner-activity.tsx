"use client";

import { useState } from "react";
import { Mail, MessageCircle } from "lucide-react";
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
import type { ShopView } from "@/features/shops/queries";
import type {
  BookingChangeActivityView,
  NotificationActivityRow,
  NotificationActivityView,
} from "@/features/notifications/types";

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
  tabs: "col-start-1 row-start-1 flex min-w-0 flex-wrap items-center gap-2 max-[520px]:grid max-[520px]:w-full max-[520px]:grid-cols-2 [&>button]:min-h-10 [&>button]:rounded-full [&>button]:text-xs max-[520px]:[&>button]:min-w-0 max-[520px]:[&>button]:whitespace-normal max-[520px]:[&>button]:px-1 max-[520px]:[&>button]:py-1.5 max-[520px]:[&>button]:text-[10px] [&_button_span]:rounded-full [&_button_span]:bg-secondary [&_button_span]:px-[5px] [&_button_span]:text-[10px]",
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
    "grid min-w-0 gap-[3px] [&>h3]:text-[13px] [&>h3]:font-semibold [&>h3]:leading-[1.4] [&>h3>span]:ml-[3px] [&>h3>span]:rounded-[5px] [&>h3>span]:bg-[var(--surface)] [&>h3>span]:px-[5px] [&>h3>span]:py-0.5 [&>h3>span]:text-[10px] [&>h3>span]:font-medium [&>h3>span]:text-[var(--muted-foreground)] [&>h3>span]:[overflow-wrap:anywhere] [&>small]:[overflow-wrap:anywhere] [&>p]:text-xs [&>p]:leading-[1.4] [&>p]:text-[var(--muted-foreground)] [&>small]:mt-[3px] [&>small]:text-[10px] [&>small]:leading-[1.4] [&>small]:text-[var(--muted-foreground)] max-[520px]:[&>h3]:text-xs max-[520px]:[&>p]:text-[11px] max-[520px]:[&>small]:text-[9px]",
  eventStatus:
    "justify-self-end whitespace-normal rounded-full bg-secondary px-2 py-1 text-[10px] font-bold [overflow-wrap:anywhere] max-[520px]:col-start-2 max-[520px]:justify-self-start max-[520px]:max-w-full",
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

const categories = [
  "All messages",
  "Customer confirmation",
  "Owner alert",
  "Customer update",
  "Owner cancellation alert",
  "Owner reschedule alert",
] as const;
const channels = ["All", "Email", "WhatsApp"] as const;

type Row = NotificationActivityRow;

function title(row: Row) {
  if (row.kind === "customer_confirmation") return "Customer confirmation";
  if (row.kind === "owner_alert") return "Owner alert";
  if (row.kind === "owner_cancellation") return "Owner cancellation alert";
  if (row.kind === "owner_move") return "Owner reschedule alert";
  return row.kind === "customer_move"
    ? "Reschedule update"
    : "Cancellation update";
}

function statusLabel(row: Row) {
  if (row.status === "unknown") return "Unknown · invocation/result uncertain";
  if (row.attempt?.reservedAt && !row.attempt.invokedAt)
    return `${row.status.replaceAll("_", " ")} · invocation unconfirmed`;
  if (row.status === "accepted") return "Accepted by local capture service";
  if (row.status === "captured")
    return "Captured locally · inbox delivery is not enabled";
  return row.status.replaceAll("_", " ");
}

function date(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

export function OwnerActivity({
  shop,
  activity,
  changes,
  loadFailed = false,
}: {
  shop: ShopView;
  activity: NotificationActivityView | null;
  changes: BookingChangeActivityView | null;
  loadFailed?: boolean;
}) {
  const [category, setCategory] =
    useState<(typeof categories)[number]>("All messages");
  const [channel, setChannel] = useState<(typeof channels)[number]>("All");
  const [search, setSearch] = useState("");
  const [row, setRow] = useState<Row | null>(null);
  const events = activity?.rows ?? [];
  const changeEvents = changes?.rows ?? [];
  const filtered = events.filter(
    (event) =>
      (category === "All messages" ||
        title(event) === category ||
        (category === "Customer update" &&
          ["customer_move", "customer_cancellation"].includes(event.kind))) &&
      (channel === "All" ||
        event.channel.toLowerCase() === channel.toLowerCase()) &&
      `${title(event)} ${event.recipient ?? ""} ${event.bookingId} ${event.id} ${event.status} ${event.reason ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const count = (value: string) =>
    events.filter(
      (event) =>
        value === "All messages" ||
        title(event) === value ||
        (value === "Customer update" &&
          ["customer_move", "customer_cancellation"].includes(event.kind)),
    ).length;

  return (
    <main className={`${c.workspace} ${c.activityWorkspace}`}>
      <header className={c.activityHeader}>
        <div className={c.eyebrowRow}>
          <span>{shop.name} · owner audit</span>
          <span className={c.tzBadge}>{shop.timeZone}</span>
          <span className={c.tzBadge}>
            {shop.published ? "Published" : "Unpublished"}
          </span>
          <span className={c.sampleBadge}>Live notification records</span>
        </div>
        <h1>Booking activity &amp; message status</h1>
        <p>
          Message status and transport evidence for this shop. Local capture
          does not mean inbox delivery.
        </p>
      </header>
      {!loadFailed && (
        <section className={c.stats} aria-label="Own-shop notification metrics">
          <article className={c.statCard}>
            <span>Messages for this shop</span>
            <strong>{events.length}</strong>
            <p>Current notification records only.</p>
          </article>
          <article className={c.statCard}>
            <span>Captured locally</span>
            <strong>
              {events.filter((event) => event.status === "captured").length}
            </strong>
            <p>Inbox delivery is not enabled.</p>
          </article>
          <article className={c.statCard}>
            <span>Confirmed transport invocations</span>
            <strong>
              {events.filter((event) => event.attempt?.invokedAt).length}
            </strong>
            <p>For this shop’s records only.</p>
          </article>
        </section>
      )}
      {!loadFailed && (
        <section className={c.activityTools} aria-label="Activity filters">
          <div className={c.tabs} role="group" aria-label="Activity type">
            {categories.map((item) => (
              <Button
                key={item}
                variant={category === item ? "secondary" : "ghost"}
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
              >
                {item} <span>{count(item)}</span>
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled
              title="Export is unavailable in this phase"
            >
              Export unavailable
            </Button>
            <Button
              variant="outline"
              disabled
              title="Resend is unavailable in this phase"
            >
              Resend unavailable
            </Button>
            <Button
              variant="outline"
              disabled
              title="Reminders are unavailable in this phase"
            >
              Reminders unavailable
            </Button>
          </div>
          <div className={c.filterLine}>
            <Input
              aria-label="Search activity"
              placeholder="Filter by message, ID, email, or status…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div
              className={c.channels}
              role="group"
              aria-label="Channel filter"
            >
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
      )}
      <div className={c.eventGroups} aria-live="polite">
        {loadFailed ? (
          <p role="alert" className={c.noMatches}>
            Activity could not be loaded. Try again later.
          </p>
        ) : (
          <>
            <section className={c.eventGroup}>
              <header>
                <h2>Recent appointment changes</h2>
                <span>
                  {changeEvents.length}{" "}
                  {changeEvents.length === 1 ? "change" : "changes"}
                </span>
              </header>
              {changeEvents.length ? (
                changeEvents.map((event) => {
                  const before = event.before;
                  const after = event.after;
                  return (
                    <article className={c.activityEvent} key={event.id}>
                      <span className={c.eventIcon} aria-hidden="true">
                        ✎
                      </span>
                      <div className={c.eventCopy}>
                        <h3>
                          {event.kind === "move"
                            ? "Appointment rescheduled"
                            : "Appointment cancelled"}
                        </h3>
                        <p>
                          Booking #{event.bookingId} · revision {event.revision}{" "}
                          ·{" "}
                          {event.actorType === "customer"
                            ? "Customer-initiated"
                            : "Shop-initiated"}
                        </p>
                        <small>
                          Before: {String(before.serviceName)} ·{" "}
                          {String(before.barberName)} ·{" "}
                          {date(String(before.startAt), shop.timeZone)} –{" "}
                          {date(String(before.endAt), shop.timeZone)}
                        </small>
                        <small>
                          After: {String(after.serviceName)} ·{" "}
                          {String(after.barberName)} ·{" "}
                          {date(String(after.startAt), shop.timeZone)} –{" "}
                          {date(String(after.endAt), shop.timeZone)} ·{" "}
                          {String(after.status)}
                        </small>
                        <small>
                          Recorded {date(event.committedAt, shop.timeZone)}
                        </small>
                      </div>
                    </article>
                  );
                })
              ) : (
                <p className={c.noMatches}>
                  No appointment changes recorded for this shop.
                </p>
              )}
            </section>
            <section className={c.eventGroup}>
              <header>
                <h2>Notification records</h2>
                <span>
                  {filtered.length}{" "}
                  {filtered.length === 1 ? "message" : "messages"}
                </span>
              </header>
              {filtered.length ? (
                filtered.map((event) => (
                  <article className={c.activityEvent} key={event.id}>
                    <span className={c.eventIcon} aria-hidden="true">
                      {event.channel === "whatsapp" ? (
                        <MessageCircle className="size-4" />
                      ) : (
                        <Mail className="size-4" />
                      )}
                    </span>
                    <div className={c.eventCopy}>
                      <h3>
                        {title(event)}{" "}
                        {event.kind === "customer_confirmation" &&
                          event.creationSource === "owner" && (
                            <span>Manual appointment</span>
                          )}{" "}
                        <span>#{event.id}</span>
                      </h3>
                      <p>
                        Booking #{event.bookingId} · {event.channel}
                      </p>
                      <small>
                        Updated {date(event.updatedAt, shop.timeZone)} ·{" "}
                        {event.recipient ?? "No authorized recipient"}
                      </small>
                      {event.creationSource === "owner" && !event.recipient && (
                        <small>
                          No email recipient was provided; no notification
                          channel is available.
                        </small>
                      )}
                    </div>
                    <span className={c.eventStatus}>{statusLabel(event)}</span>
                    <div className={c.eventActions}>
                      <Button variant="outline" onClick={() => setRow(event)}>
                        Event details
                      </Button>
                    </div>
                  </article>
                ))
              ) : (
                <p className={c.noMatches}>
                  {events.length
                    ? "No messages match these filters."
                    : "No notification records yet for this shop."}
                </p>
              )}
            </section>
          </>
        )}
      </div>
      <aside className={c.retention}>
        <strong>Activity</strong>
        <p>
          Reminders are not available in this phase. Records shown here belong
          to this shop.
        </p>
        <span>Own-shop records</span>
      </aside>
      <Dialog
        open={row !== null}
        onOpenChange={(open) => !open && setRow(null)}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Message details</DialogTitle>
            <DialogDescription>
              Stored notification and transport evidence. Inbox delivery is not
              claimed.
            </DialogDescription>
          </DialogHeader>
          {row && (
            <dl className={c.details}>
              <div>
                <dt>Message</dt>
                <dd>{title(row)}</dd>
              </div>
              <div>
                <dt>Creation</dt>
                <dd>
                  {row.creationSource === "owner"
                    ? "Manual appointment"
                    : "Public booking"}
                </dd>
              </div>
              <div>
                <dt>Booking ID</dt>
                <dd>{row.bookingId}</dd>
              </div>
              <div>
                <dt>Work ID</dt>
                <dd>{row.id}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{statusLabel(row)}</dd>
              </div>
              <div>
                <dt>Authorized recipient</dt>
                <dd>{row.recipient ?? "None"}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{row.reason ?? "None recorded"}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{date(row.createdAt, shop.timeZone)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{date(row.updatedAt, shop.timeZone)}</dd>
              </div>
              <div>
                <dt>Budget reservation</dt>
                <dd>
                  {row.attempt
                    ? `${row.attempt.budgetDay} UTC · ${date(row.attempt.reservedAt, "UTC")}`
                    : "None"}
                </dd>
              </div>
              <div>
                <dt>Transport invocation</dt>
                <dd>
                  {row.attempt?.invokedAt
                    ? `${date(row.attempt.invokedAt, "UTC")} UTC`
                    : "Not confirmed"}
                </dd>
              </div>
              <div>
                <dt>Attempt outcome</dt>
                <dd>{row.attempt?.outcome ?? "None"}</dd>
              </div>
              <div>
                <dt>Capture ID</dt>
                <dd>{row.attempt?.captureId ?? "None"}</dd>
              </div>
              <div className={c.payload}>
                <dt>Inbox delivery</dt>
                <dd>
                  {row.status === "captured"
                    ? "Captured locally; inbox delivery is not enabled."
                    : "Not verified or claimed."}
                </dd>
              </div>
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
