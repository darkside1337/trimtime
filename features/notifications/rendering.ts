import {
  canonicalManageUrl,
  decryptCapability,
  hashSecret,
} from "@/features/bookings/capabilities";
import {
  renderCustomerConfirmation,
  renderCustomerRestoration,
  renderCustomerUpdate,
  renderOwnerAlert,
  renderOwnerCancellationAlert,
  renderOwnerMoveAlert,
  type BookingMessageSnapshot,
  type OutboundMessage,
} from "./messages";
import type { NotificationKind } from "./eligibility";

type RenderingInput = {
  kind: NotificationKind;
  booking: BookingMessageSnapshot & {
    capabilityHash: string;
    capabilityCiphertext: string;
    capabilityKeyId: string;
    shopId: string;
    subdomain: string;
  };
  recipient: string;
  beforeSnapshot: { startAt: string; endAt: string } | null;
  changeActor: string | null;
  activityUrl: string;
};

export type RenderingResult =
  | { ok: true; message: OutboundMessage }
  | {
      ok: false;
      status: "skipped";
      reason: "capability_unavailable" | "message_render_failed";
    };

const customerKinds = new Set<NotificationKind>([
  "customer_confirmation",
  "customer_move",
  "customer_cancellation",
  "customer_restoration",
]);

export function buildNotificationMessage(
  input: RenderingInput,
): RenderingResult {
  let manageUrl: string | undefined;
  if (customerKinds.has(input.kind)) {
    let token: string;
    try {
      token = decryptCapability(
        input.booking.capabilityCiphertext,
        input.booking.capabilityKeyId,
        `${input.booking.shopId}:${input.booking.id}`,
      );
      if (hashSecret(token) !== input.booking.capabilityHash)
        throw new Error("Capability mismatch.");
    } catch {
      return {
        ok: false,
        status: "skipped",
        reason: "capability_unavailable",
      };
    }

    try {
      manageUrl = canonicalManageUrl(input.booking.subdomain, token);
    } catch {
      return {
        ok: false,
        status: "skipped",
        reason: "message_render_failed",
      };
    }
  }

  try {
    if (input.kind === "customer_confirmation") {
      return {
        ok: true,
        message: renderCustomerConfirmation({
          booking: input.booking,
          recipient: input.recipient,
          manageUrl: manageUrl!,
        }),
      };
    }
    if (input.kind === "customer_restoration") {
      return {
        ok: true,
        message: renderCustomerRestoration({
          booking: input.booking,
          recipient: input.recipient,
          manageUrl: manageUrl!,
        }),
      };
    }
    if (
      input.kind === "customer_move" ||
      input.kind === "customer_cancellation"
    ) {
      if (!input.beforeSnapshot)
        throw new Error("Change snapshot is unavailable.");
      return {
        ok: true,
        message: renderCustomerUpdate({
          booking: input.booking,
          recipient: input.recipient,
          manageUrl: manageUrl!,
          kind: input.kind === "customer_move" ? "move" : "cancel",
          actor: input.changeActor === "customer" ? "customer" : "owner",
          before: input.beforeSnapshot,
        }),
      };
    }
    if (input.kind === "owner_move") {
      return {
        ok: true,
        message: renderOwnerMoveAlert({
          booking: input.booking,
          recipient: input.recipient,
          activityUrl: input.activityUrl,
        }),
      };
    }
    if (input.kind === "owner_cancellation") {
      return {
        ok: true,
        message: renderOwnerCancellationAlert({
          booking: input.booking,
          recipient: input.recipient,
          activityUrl: input.activityUrl,
        }),
      };
    }
    return {
      ok: true,
      message: renderOwnerAlert({
        booking: input.booking,
        recipient: input.recipient,
        activityUrl: input.activityUrl,
      }),
    };
  } catch {
    return {
      ok: false,
      status: "skipped",
      reason: "message_render_failed",
    };
  }
}
