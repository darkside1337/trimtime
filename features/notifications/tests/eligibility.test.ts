import { describe, expect, it } from "vitest";
import { notificationContentIdentity } from "../content-identity";
import {
  evaluateNotificationEligibility,
  type NotificationKind,
} from "../eligibility";

const baseBooking = {
  id: "booking-1",
  customerName: "Ari Client",
  customerEmail: "ari@example.test",
  customerPhone: null,
  serviceName: "Cut",
  servicePriceUsd: "25.00",
  serviceDurationMinutes: 30,
  barberName: "Sam Barber",
  startAt: "2026-01-15T14:00:00.000Z",
  endAt: "2026-01-15T14:30:00.000Z",
  shop: {
    name: "Northside Barber",
    address: "1 Sample Road",
    publicContact: "Call 555-0100",
    timeZone: "America/New_York",
  },
  revision: 0,
  status: "confirmed",
  capabilityRevokedAt: null,
};

function input(
  overrides: {
    booking?: Partial<typeof baseBooking>;
    kind?: NotificationKind;
    workRevision?: number;
    changeKind?: string | null;
    changeActor?: string | null;
    changeRevision?: number | null;
    recipient?: string | null;
    expectedContentIdentity?: string;
    now?: Date;
    emailAvailable?: boolean;
    emailUnavailableReason?: string;
  } = {},
) {
  const booking = { ...baseBooking, ...overrides.booking };
  const kind = overrides.kind ?? "customer_confirmation";
  const workRevision = overrides.workRevision ?? 0;
  const changeKind = overrides.changeKind ?? null;
  const changeActor = overrides.changeActor ?? null;
  const changeRevision = overrides.changeRevision ?? null;
  const recipient =
    overrides.recipient === undefined
      ? "ari@example.test"
      : overrides.recipient;
  const expectedContentIdentity = notificationContentIdentity({
    ...booking,
    id: booking.id,
  });
  return {
    kind,
    booking,
    bookingId: booking.id,
    workRevision,
    changeKind,
    changeActor,
    changeRevision,
    recipient,
    ownerEmail: "owner@example.test",
    expectedContentIdentity:
      overrides.expectedContentIdentity ?? expectedContentIdentity,
    now: overrides.now ?? new Date("2026-01-15T15:00:00.000Z"),
    emailAvailable: overrides.emailAvailable ?? true,
    emailUnavailableReason:
      overrides.emailUnavailableReason ?? "email_disabled",
  };
}

describe("notification eligibility", () => {
  it("suppresses an unrecognized work kind even for a current customer cancellation", () => {
    const candidate = input({
      booking: { status: "cancelled", revision: 2 },
      workRevision: 2,
      changeKind: "cancel",
      changeActor: "customer",
      changeRevision: 2,
      recipient: "owner@example.test",
    });
    expect(
      evaluateNotificationEligibility({ ...candidate, kind: "unknown" }),
    ).toEqual({
      eligible: false,
      status: "suppressed",
      reason: "work_no_longer_eligible",
    });
  });
  it.each([
    ["customer_confirmation", "confirmed", 0, 0, null, null, null],
    ["owner_alert", "confirmed", 0, 0, null, null, null],
    ["customer_move", "confirmed", 2, 2, "move", "owner", 2],
    ["owner_move", "confirmed", 2, 2, "move", "customer", 2],
    ["customer_cancellation", "cancelled", 2, 2, "cancel", "owner", 2],
    ["customer_restoration", "confirmed", 2, 2, "restore", "owner", 2],
    ["owner_cancellation", "cancelled", 2, 2, "cancel", "customer", 2],
  ] as const)(
    "accepts the current %s work with its event identity",
    (
      kind,
      status,
      revision,
      workRevision,
      changeKind,
      changeActor,
      changeRevision,
    ) => {
      const result = evaluateNotificationEligibility(
        input({
          kind,
          booking: { status, revision },
          workRevision,
          changeKind,
          changeActor,
          changeRevision,
          recipient:
            kind === "customer_confirmation" ||
            kind === "customer_move" ||
            kind === "customer_cancellation" ||
            kind === "customer_restoration"
              ? "ari@example.test"
              : "owner@example.test",
        }),
      );

      expect(result).toEqual({
        eligible: true,
        recipient:
          kind === "customer_confirmation" ||
          kind === "customer_move" ||
          kind === "customer_cancellation" ||
          kind === "customer_restoration"
            ? "ari@example.test"
            : "owner@example.test",
      });
    },
  );

  it("preserves unavailable and missing-recipient outcomes before eligibility checks", () => {
    expect(
      evaluateNotificationEligibility(
        input({ emailAvailable: false, recipient: null }),
      ),
    ).toEqual({
      eligible: false,
      status: "unavailable",
      reason: "email_disabled",
    });
    expect(evaluateNotificationEligibility(input({ recipient: null }))).toEqual(
      {
        eligible: false,
        status: "skipped",
        reason: "recipient_missing",
      },
    );
  });

  it.each([
    ["revoked capability", { booking: { capabilityRevokedAt: new Date() } }],
    ["expired booking", { now: new Date("2026-01-22T14:30:00.000Z") }],
    ["recipient mismatch", { recipient: "other@example.test" }],
    ["changed content identity", { expectedContentIdentity: "different" }],
    ["obsolete revision", { booking: { revision: 1 } }],
  ])("suppresses %s", (_case, overrides) => {
    expect(
      evaluateNotificationEligibility(
        input(overrides as Parameters<typeof input>[0]),
      ),
    ).toEqual({
      eligible: false,
      status: "suppressed",
      reason: "work_no_longer_eligible",
    });
  });

  it("treats equality at scheduled end plus seven days as expired", () => {
    expect(
      evaluateNotificationEligibility(
        input({ now: new Date("2026-01-22T14:30:00.000Z") }),
      ),
    ).toMatchObject({ eligible: false, reason: "work_no_longer_eligible" });
  });
});
