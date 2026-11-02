import { z } from "zod";
import { createPublicBookingSchema } from "../../schemas";
import type { PublicBookingInput } from "../../types";

export const PENDING_BOOKING_STORAGE_KEY = "trimtime:pending-booking-recovery";
export const PENDING_BOOKING_WARNING_STORAGE_KEY =
  "trimtime:pending-booking-warning";
export const PENDING_BOOKING_RETENTION_MS = 60 * 60_000;

const RECOVERY_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const WARNING_KINDS = [
  "uncertain",
  "mismatch",
  "legacy",
  "expired",
  "corrupt",
] as const;

export type RecoveryWarningKind = (typeof WARNING_KINDS)[number];

const storedAttemptSchema = z
  .object({
    version: z.literal(1),
    recoveryKey: z.string(),
    payload: z.unknown(),
    savedAt: z.number().int().nonnegative(),
  })
  .strict();

const storedWarningSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(WARNING_KINDS),
    savedAt: z.number().int().nonnegative(),
  })
  .strict();

export type BookingPayload = Omit<PublicBookingInput, "recoveryKey">;

export type PendingBookingAttempt = {
  recoveryKey: string;
  payload: BookingPayload;
  savedAt: number;
};

export type PendingBookingWarning = {
  kind: RecoveryWarningKind;
  savedAt: number;
};

export type PendingBookingRead =
  | { status: "saved"; attempt: PendingBookingAttempt }
  | { status: "none" }
  | { status: "unavailable" }
  | {
      status: Exclude<RecoveryWarningKind, "uncertain" | "mismatch">;
      warningPersisted: boolean;
    };

export type PendingWarningRead =
  | { status: "none" }
  | { status: "unavailable" }
  | { status: "found"; warning: PendingBookingWarning };

export type RecoveryRestore =
  | { status: "none"; degraded: boolean }
  | { status: "unavailable"; degraded: boolean }
  | { status: "warning"; notice: RecoveryWarningKind; degraded: boolean }
  | {
      status: "attempt";
      attempt: PendingBookingAttempt;
      notice: "saved" | RecoveryWarningKind;
      degraded: boolean;
    };

export type BookingFailureDisposition = "mismatch" | "unknown" | "terminal";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function browserSessionStorage(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function isRecoveryKey(value: string) {
  return RECOVERY_KEY_PATTERN.test(value);
}

export function isPendingAttemptExpired(
  attempt: PendingBookingAttempt,
  now = Date.now(),
) {
  return now - attempt.savedAt > PENDING_BOOKING_RETENTION_MS;
}

export function serializeBookingPayload(payload: BookingPayload) {
  return JSON.stringify({
    serviceId: payload.serviceId,
    barberId: payload.barberId,
    startAt: payload.startAt,
    reviewedOffer: {
      name: payload.reviewedOffer.name,
      priceUsd: payload.reviewedOffer.priceUsd,
      durationMinutes: payload.reviewedOffer.durationMinutes,
    },
    contact: {
      name: payload.contact.name,
      email: payload.contact.email,
      phone: payload.contact.phone ?? "",
      whatsappOptIn: payload.contact.whatsappOptIn,
    },
  });
}

export function sameBookingPayload(a: BookingPayload, b: BookingPayload) {
  return serializeBookingPayload(a) === serializeBookingPayload(b);
}

/**
 * Classifies a Server Action failure from the perspective of the attempt that
 * was just sent.
 *
 * `SHOP_PAUSED`, `VALIDATION_ERROR`, and `UNAVAILABLE` can be produced before
 * the server looks up the recovery key, so after an unknown outcome they do
 * not prove the original request failed. Only denials produced after that
 * lookup (rate limit, stale offer, unavailable interval) are terminal, plus
 * pre-lookup denials for a brand-new key whose request cannot have committed.
 */
export function classifyBookingFailure(
  code: string | undefined,
  recovering: boolean,
): BookingFailureDisposition {
  if (code === "RECOVERY_MISMATCH") return "mismatch";
  if (!code || code === "UNAVAILABLE") return "unknown";
  if (
    code === "RATE_LIMITED" ||
    code === "STALE_OFFER" ||
    code === "UNAVAILABLE_INTERVAL"
  )
    return "terminal";
  if (!recovering && (code === "SHOP_PAUSED" || code === "VALIDATION_ERROR"))
    return "terminal";
  return "unknown";
}

function persistWarning(
  storage: StorageLike | null,
  kind: RecoveryWarningKind,
  savedAt: number,
) {
  if (!storage) return false;
  try {
    storage.setItem(
      PENDING_BOOKING_WARNING_STORAGE_KEY,
      JSON.stringify({ version: 1, kind, savedAt }),
    );
    return true;
  } catch {
    return false;
  }
}

export function savePendingWarning(
  storage: StorageLike | null,
  kind: RecoveryWarningKind,
  savedAt = Date.now(),
) {
  return persistWarning(storage, kind, savedAt);
}

export function readPendingWarning(
  storage: StorageLike | null,
): PendingWarningRead {
  if (!storage) return { status: "unavailable" };

  let value: string | null;
  try {
    value = storage.getItem(PENDING_BOOKING_WARNING_STORAGE_KEY);
  } catch {
    return { status: "unavailable" };
  }
  if (value === null) return { status: "none" };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(value);
  } catch {
    // A damaged warning is still a warning: keep the booking gate closed.
    return { status: "found", warning: { kind: "corrupt", savedAt: 0 } };
  }
  const parsed = storedWarningSchema.safeParse(parsedJson);
  if (!parsed.success)
    return { status: "found", warning: { kind: "corrupt", savedAt: 0 } };

  return {
    status: "found",
    warning: { kind: parsed.data.kind, savedAt: parsed.data.savedAt },
  };
}

function removeQuietly(storage: StorageLike, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // A blocked cleanup must not break the read or the warning.
  }
}

export function readPendingAttempt(
  storage: StorageLike | null,
  now = Date.now(),
): PendingBookingRead {
  if (!storage) return { status: "unavailable" };

  let value: string | null;
  try {
    value = storage.getItem(PENDING_BOOKING_STORAGE_KEY);
  } catch {
    return { status: "unavailable" };
  }
  if (value === null) return { status: "none" };
  if (isRecoveryKey(value)) {
    const warningPersisted = persistWarning(storage, "legacy", now);
    if (warningPersisted) removeQuietly(storage, PENDING_BOOKING_STORAGE_KEY);
    return { status: "legacy", warningPersisted };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(value);
  } catch {
    const warningPersisted = persistWarning(storage, "corrupt", now);
    if (warningPersisted) removeQuietly(storage, PENDING_BOOKING_STORAGE_KEY);
    return { status: "corrupt", warningPersisted };
  }
  const envelope = storedAttemptSchema.safeParse(parsedJson);
  if (!envelope.success) {
    const warningPersisted = persistWarning(storage, "corrupt", now);
    if (warningPersisted) removeQuietly(storage, PENDING_BOOKING_STORAGE_KEY);
    return { status: "corrupt", warningPersisted };
  }
  if (
    typeof envelope.data.payload !== "object" ||
    envelope.data.payload === null ||
    Array.isArray(envelope.data.payload)
  ) {
    const warningPersisted = persistWarning(storage, "corrupt", now);
    if (warningPersisted) removeQuietly(storage, PENDING_BOOKING_STORAGE_KEY);
    return { status: "corrupt", warningPersisted };
  }

  const parsed = createPublicBookingSchema.safeParse({
    ...envelope.data.payload,
    recoveryKey: envelope.data.recoveryKey,
  });
  if (!parsed.success) {
    const warningPersisted = persistWarning(storage, "corrupt", now);
    if (warningPersisted) removeQuietly(storage, PENDING_BOOKING_STORAGE_KEY);
    return { status: "corrupt", warningPersisted };
  }

  if (now - envelope.data.savedAt > PENDING_BOOKING_RETENTION_MS) {
    // Drop the contact payload for privacy, but keep an anonymous marker so a
    // later reload still warns and still gates a fresh booking.
    const warningPersisted = persistWarning(
      storage,
      "expired",
      envelope.data.savedAt,
    );
    if (warningPersisted) removeQuietly(storage, PENDING_BOOKING_STORAGE_KEY);
    return { status: "expired", warningPersisted };
  }

  const { recoveryKey, ...payload } = parsed.data;
  return {
    status: "saved",
    attempt: {
      recoveryKey,
      payload,
      savedAt: envelope.data.savedAt,
    },
  };
}

export function resolveRecoveryRestore(
  read: PendingBookingRead,
  warning: PendingWarningRead,
): RecoveryRestore {
  if (read.status === "unavailable") {
    return { status: "unavailable", degraded: false };
  }

  if (read.status === "saved") {
    return {
      status: "attempt",
      attempt: read.attempt,
      notice:
        warning.status === "found" && warning.warning.kind === "mismatch"
          ? "mismatch"
          : "saved",
      degraded: warning.status === "unavailable",
    };
  }

  if (read.status === "none") {
    return warning.status === "found"
      ? { status: "warning", notice: warning.warning.kind, degraded: false }
      : { status: "none", degraded: warning.status === "unavailable" };
  }

  return {
    status: "warning",
    notice: read.status,
    degraded: !read.warningPersisted || warning.status === "unavailable",
  };
}

export function savePendingAttempt(
  storage: StorageLike | null,
  attempt: PendingBookingAttempt,
) {
  if (!storage) return false;
  try {
    storage.setItem(
      PENDING_BOOKING_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        recoveryKey: attempt.recoveryKey,
        payload: attempt.payload,
        savedAt: attempt.savedAt,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearPendingAttempt(storage: StorageLike | null) {
  if (!storage) return;
  removeQuietly(storage, PENDING_BOOKING_STORAGE_KEY);
}

export function clearPendingWarning(storage: StorageLike | null) {
  if (!storage) return;
  removeQuietly(storage, PENDING_BOOKING_WARNING_STORAGE_KEY);
}

export function clearPendingRecovery(storage: StorageLike | null) {
  clearPendingAttempt(storage);
  clearPendingWarning(storage);
}

export function shopDateForStart(startAt: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(startAt));
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
