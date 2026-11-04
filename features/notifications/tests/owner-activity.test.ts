import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OwnerActivity } from "../components/owner-activity";
import type { NotificationActivityRow } from "../types";

const shop = {
  id: "shop-id",
  name: "Juniper Barber",
  subdomain: "juniper",
  timeZone: "America/New_York",
  publicContact: "Call 202-555-0142",
  address: "123 Example Street",
  published: false,
};

function notification(
  overrides: Partial<NotificationActivityRow> = {},
): NotificationActivityRow {
  return {
    id: "work-1",
    bookingId: "booking-1",
    creationSource: "public",
    kind: "customer_confirmation",
    channel: "email",
    status: "failed",
    recipient: "guest@example.test",
    reason: "transient_rejection",
    createdAt: "2026-11-02T10:00:00.000Z",
    updatedAt: "2026-11-02T10:00:00.000Z",
    nextAttemptAt: null,
    dueAt: null,
    attempt: null,
    attempts: [],
    ...overrides,
  };
}

describe("owner Activity read states", () => {
  it("distinguishes empty upcoming, change, and notification records", () => {
    const markup = renderToStaticMarkup(
      createElement(OwnerActivity, {
        shop,
        activity: { rows: [] },
        changes: { rows: [] },
        upcoming: [],
      }),
    );

    expect(markup).toContain("No upcoming confirmed bookings.");
    expect(markup).toContain("No appointment changes recorded for this shop.");
    expect(markup).toContain("No notification records yet for this shop.");
    expect(markup).not.toContain("Reminders unavailable");
    expect(markup).toContain("Records shown here belong to this shop.");
    expect(markup).not.toContain("Activity could not be loaded.");
  });

  it("renders read failure separately from successful empty reads", () => {
    const markup = renderToStaticMarkup(
      createElement(OwnerActivity, {
        shop,
        activity: null,
        changes: null,
        upcoming: null,
        loadFailed: true,
      }),
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Activity could not be loaded. Try again later.");
    expect(markup).not.toContain("No upcoming confirmed bookings.");
    expect(markup).not.toContain(
      "No appointment changes recorded for this shop.",
    );
    expect(markup).not.toContain("No notification records yet for this shop.");
  });

  it("labels scheduled, exhausted, and permanent retry outcomes", () => {
    const markup = renderToStaticMarkup(
      createElement(OwnerActivity, {
        shop,
        activity: {
          rows: [
            notification({ nextAttemptAt: "2026-11-02T10:10:00.000Z" }),
            notification({
              id: "work-2",
              reason: "transient_rejection",
              attempt: {
                id: "attempt-3",
                attemptNumber: 3,
                budgetDay: "2026-11-02",
                reservedAt: "2026-11-02T10:00:00.000Z",
                invokedAt: "2026-11-02T10:00:01.000Z",
                outcome: "failed",
                captureId: null,
                reason: "transient_rejection",
                finishedAt: "2026-11-02T10:00:02.000Z",
              },
            }),
            notification({ id: "work-3", reason: "permanent_rejection" }),
          ],
        },
        changes: { rows: [] },
        upcoming: [],
      }),
    );

    expect(markup).toContain("Retry scheduled");
    expect(markup).toContain("Attempts exhausted");
    expect(markup).toContain("Permanent failure");
  });

  it("counts persisted invocations across attempts while rendering one work row", () => {
    const firstAttempt = {
      id: "attempt-1",
      attemptNumber: 1,
      budgetDay: "2026-11-02",
      reservedAt: "2026-11-02T10:00:00.000Z",
      invokedAt: "2026-11-02T10:00:01.000Z",
      outcome: "failed" as const,
      captureId: null,
      reason: "transient_rejection",
      finishedAt: "2026-11-02T10:00:02.000Z",
    };
    const secondAttempt = {
      ...firstAttempt,
      id: "attempt-2",
      attemptNumber: 2,
      reservedAt: "2026-11-02T10:10:00.000Z",
      invokedAt: "2026-11-02T10:10:01.000Z",
      outcome: "accepted" as const,
      reason: null,
      finishedAt: null,
    };
    const reservationOnlyAttempt = {
      ...firstAttempt,
      id: "attempt-reserved-only",
      attemptNumber: 1,
      invokedAt: null,
      outcome: null,
      reason: null,
      finishedAt: null,
    };
    const markup = renderToStaticMarkup(
      createElement(OwnerActivity, {
        shop,
        activity: {
          rows: [
            notification({
              id: "work-history",
              status: "accepted",
              attempt: secondAttempt,
              attempts: [firstAttempt, secondAttempt],
            }),
            notification({
              id: "work-reserved-only",
              status: "sending",
              attempt: reservationOnlyAttempt,
              attempts: [reservationOnlyAttempt],
            }),
          ],
        },
        changes: { rows: [] },
        upcoming: [],
      }),
    );

    expect(markup).toMatch(
      /Confirmed transport invocations<\/span><strong>2<\/strong>/,
    );
    expect(markup.match(/#work-history/g)).toHaveLength(1);
  });

  it("keeps unknown, accepted, and captured outcomes distinct", () => {
    const markup = renderToStaticMarkup(
      createElement(OwnerActivity, {
        shop,
        activity: {
          rows: [
            notification({ id: "unknown-work", status: "unknown" }),
            notification({ id: "accepted-work", status: "accepted" }),
            notification({ id: "captured-work", status: "captured" }),
          ],
        },
        changes: { rows: [] },
        upcoming: [],
      }),
    );

    expect(markup).toContain("Unknown · invocation/result uncertain");
    expect(markup).toContain("Accepted by local capture service");
    expect(markup).toContain(
      "Captured locally · inbox delivery is not enabled",
    );
    expect(markup).not.toContain("delivered");
  });

  it("shows reminder due time separately from retry time and preserves confirmation labels", () => {
    const markup = renderToStaticMarkup(
      createElement(OwnerActivity, {
        shop,
        activity: {
          rows: [
            notification({
              kind: "customer_reminder",
              status: "not_attempted",
              dueAt: "2026-11-03T12:00:00.000Z",
              nextAttemptAt: null,
            }),
            notification({
              id: "retry-reminder",
              kind: "customer_reminder",
              status: "failed",
              dueAt: "2026-11-03T12:00:00.000Z",
              nextAttemptAt: "2026-11-03T12:10:00.000Z",
            }),
            notification({
              id: "confirmation",
              kind: "customer_confirmation",
              status: "captured",
            }),
          ],
        },
        changes: { rows: [] },
        upcoming: [],
      }),
    );

    expect(markup).toContain("Customer reminder");
    expect(markup).toContain("Scheduled reminder");
    expect(markup).toContain("Due Nov 3, 2026, 7:00 AM");
    expect(markup).toContain("Retry Nov 3, 2026, 7:10 AM");
    expect(markup).toContain("Customer confirmation");
    expect(markup).toContain(
      "Captured locally · inbox delivery is not enabled",
    );
    expect(markup).not.toContain("Reminders are not available in this phase.");
  });
});
