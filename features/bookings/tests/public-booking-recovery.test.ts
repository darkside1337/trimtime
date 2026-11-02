import { describe, expect, it } from "vitest";
import {
  PENDING_BOOKING_RETENTION_MS,
  PENDING_BOOKING_STORAGE_KEY,
  PENDING_BOOKING_WARNING_STORAGE_KEY,
  classifyBookingFailure,
  clearPendingAttempt,
  clearPendingRecovery,
  readPendingAttempt,
  readPendingWarning,
  resolveRecoveryRestore,
  sameBookingPayload,
  savePendingAttempt,
  savePendingWarning,
  shopDateForStart,
  type BookingPayload,
  type PendingBookingAttempt,
} from "../components/booking-flow/recovery";

const RECOVERY_KEY = "A".repeat(43);

const payload: BookingPayload = {
  serviceId: "service-1",
  barberId: "barber-1",
  startAt: "2026-11-02T14:00:00.000Z",
  reviewedOffer: {
    name: "Cut",
    priceUsd: "35.00",
    durationMinutes: "35",
  },
  contact: {
    name: "Ada Lovelace",
    email: "ada@example.test",
    phone: "+12025550142",
    whatsappOptIn: true,
  },
};

const attempt: PendingBookingAttempt = {
  recoveryKey: RECOVERY_KEY,
  payload,
  savedAt: 1_700_000_000_000,
};

class MemoryStorage {
  values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function storedEnvelope(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    recoveryKey: RECOVERY_KEY,
    payload,
    savedAt: attempt.savedAt,
    ...overrides,
  });
}

describe("public booking recovery storage", () => {
  it("round-trips the original payload and key within the retention window", () => {
    const storage = new MemoryStorage();
    expect(savePendingAttempt(storage, attempt)).toBe(true);

    const read = readPendingAttempt(storage, attempt.savedAt + 1_000);

    expect(read).toEqual({ status: "saved", attempt });
  });

  it("treats a legacy key-only value as legacy instead of trusting it", () => {
    const storage = new MemoryStorage();
    storage.setItem(PENDING_BOOKING_STORAGE_KEY, RECOVERY_KEY);

    expect(readPendingAttempt(storage, attempt.savedAt)).toEqual({
      status: "legacy",
      warningPersisted: true,
    });
    expect(storage.getItem(PENDING_BOOKING_STORAGE_KEY)).toBeNull();
  });

  it("rejects malformed, mismatched, and authority-looking storage entries", () => {
    const entries = [
      "{not json",
      JSON.stringify({ recoveryKey: RECOVERY_KEY, payload }),
      storedEnvelope({ version: 2 }),
      storedEnvelope({ extra: true }),
      storedEnvelope({ recoveryKey: "not-a-recovery-key" }),
      storedEnvelope({ payload: { ...payload, extra: true } }),
      storedEnvelope({
        payload: {
          ...payload,
          contact: { ...payload.contact, phone: undefined },
        },
      }),
      storedEnvelope({
        payload: { ...payload, startAt: "2026-11-02T14:00:30Z" },
      }),
    ];

    for (const entry of entries) {
      const storage = new MemoryStorage();
      storage.setItem(PENDING_BOOKING_STORAGE_KEY, entry);
      expect(readPendingAttempt(storage, attempt.savedAt + 1_000)).toEqual({
        status: "corrupt",
        warningPersisted: true,
      });
      expect(storage.getItem(PENDING_BOOKING_STORAGE_KEY)).toBeNull();
      expect(readPendingWarning(storage)).toEqual({
        status: "found",
        warning: { kind: "corrupt", savedAt: attempt.savedAt + 1_000 },
      });
    }
  });

  it("expires stale attempts, removes the contact payload, and keeps an anonymous warning", () => {
    const storage = new MemoryStorage();
    expect(savePendingAttempt(storage, attempt)).toBe(true);

    const read = readPendingAttempt(
      storage,
      attempt.savedAt + PENDING_BOOKING_RETENTION_MS + 1,
    );

    expect(read).toEqual({ status: "expired", warningPersisted: true });
    expect(storage.getItem(PENDING_BOOKING_STORAGE_KEY)).toBeNull();
    const warning = storage.getItem(PENDING_BOOKING_WARNING_STORAGE_KEY);
    expect(warning).not.toBeNull();
    expect(warning).not.toContain(payload.contact.email);
    expect(warning).not.toContain(payload.contact.name);
    expect(warning).not.toContain(RECOVERY_KEY);
    expect(readPendingWarning(storage)).toEqual({
      status: "found",
      warning: { kind: "expired", savedAt: attempt.savedAt },
    });
  });

  it("survives unavailable or full storage without throwing", () => {
    const unavailable = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };

    expect(readPendingAttempt(unavailable, attempt.savedAt)).toEqual({
      status: "unavailable",
    });
    expect(savePendingAttempt(unavailable, attempt)).toBe(false);
    expect(() => clearPendingAttempt(unavailable)).not.toThrow();
  });

  it("compares every submitted field rather than only the recovery key", () => {
    const same = {
      ...payload,
      contact: { ...payload.contact, phone: undefined },
    };
    const withoutPhone = {
      ...payload,
      contact: { ...payload.contact },
    };
    delete withoutPhone.contact.phone;

    expect(sameBookingPayload(same, withoutPhone)).toBe(true);
    expect(
      sameBookingPayload(payload, {
        ...payload,
        contact: { ...payload.contact, email: "grace@example.test" },
      }),
    ).toBe(false);
    expect(
      sameBookingPayload(payload, {
        ...payload,
        reviewedOffer: { ...payload.reviewedOffer, priceUsd: "40.00" },
      }),
    ).toBe(false);
  });

  it("derives the shop-local date from the submitted instant", () => {
    expect(
      shopDateForStart("2026-11-02T14:00:00.000Z", "America/New_York"),
    ).toBe("2026-11-02");
    expect(
      shopDateForStart("2026-11-03T03:00:00.000Z", "America/New_York"),
    ).toBe("2026-11-02");
  });
});

class FailingWriteStorage extends MemoryStorage {
  failWrites = false;

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("quota exceeded");
    super.setItem(key, value);
  }
}

describe("public booking recovery warning", () => {
  it("keeps an anonymous warning tombstone across repeated expired reads", () => {
    const storage = new MemoryStorage();
    expect(savePendingAttempt(storage, attempt)).toBe(true);

    const expiredAt = attempt.savedAt + PENDING_BOOKING_RETENTION_MS + 1;
    const first = readPendingAttempt(storage, expiredAt);
    const second = readPendingAttempt(storage, expiredAt + 1_000);
    const third = readPendingAttempt(storage, expiredAt + 2_000);

    expect(first).toEqual({ status: "expired", warningPersisted: true });
    expect(second).toEqual({ status: "none" });
    expect(third).toEqual({ status: "none" });
    const warning = readPendingWarning(storage);
    expect(warning).toEqual({
      status: "found",
      warning: { kind: "expired", savedAt: attempt.savedAt },
    });
    expect(resolveRecoveryRestore(second, warning)).toEqual({
      status: "warning",
      notice: "expired",
      degraded: false,
    });
    expect(resolveRecoveryRestore(third, warning)).toEqual({
      status: "warning",
      notice: "expired",
      degraded: false,
    });
    expect(storage.getItem(PENDING_BOOKING_WARNING_STORAGE_KEY)).not.toContain(
      payload.contact.email,
    );
  });

  it("retains the recoverable request and a mismatch warning across reloads", () => {
    const storage = new MemoryStorage();
    expect(savePendingAttempt(storage, attempt)).toBe(true);
    expect(savePendingWarning(storage, "mismatch", attempt.savedAt)).toBe(true);

    const read = readPendingAttempt(storage, attempt.savedAt + 1_000);
    const warning = readPendingWarning(storage);

    expect(read).toEqual({ status: "saved", attempt });
    expect(warning).toEqual({
      status: "found",
      warning: { kind: "mismatch", savedAt: attempt.savedAt },
    });
    expect(resolveRecoveryRestore(read, warning)).toEqual({
      status: "attempt",
      attempt,
      notice: "mismatch",
      degraded: false,
    });
    expect(storage.getItem(PENDING_BOOKING_STORAGE_KEY)).not.toBeNull();
  });

  it("restores a saved attempt as recoverable regardless of an uncertain warning", () => {
    const storage = new MemoryStorage();
    expect(savePendingAttempt(storage, attempt)).toBe(true);
    expect(savePendingWarning(storage, "uncertain", attempt.savedAt)).toBe(
      true,
    );

    const read = readPendingAttempt(storage, attempt.savedAt + 1_000);
    const warning = readPendingWarning(storage);

    expect(resolveRecoveryRestore(read, warning)).toEqual({
      status: "attempt",
      attempt,
      notice: "saved",
      degraded: false,
    });
  });

  it("keeps a warning-only state gated when no recoverable payload remains", () => {
    const storage = new MemoryStorage();
    expect(savePendingWarning(storage, "uncertain", attempt.savedAt)).toBe(
      true,
    );

    const read = readPendingAttempt(storage, attempt.savedAt + 1_000);
    const warning = readPendingWarning(storage);

    expect(read).toEqual({ status: "none" });
    expect(resolveRecoveryRestore(read, warning)).toEqual({
      status: "warning",
      notice: "uncertain",
      degraded: false,
    });
  });

  it("clears the attempt and the warning only on an explicit decision", () => {
    const storage = new MemoryStorage();
    savePendingAttempt(storage, attempt);
    savePendingWarning(storage, "expired", attempt.savedAt);

    clearPendingRecovery(storage);

    expect(storage.getItem(PENDING_BOOKING_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(PENDING_BOOKING_WARNING_STORAGE_KEY)).toBeNull();
    expect(readPendingAttempt(storage, attempt.savedAt)).toEqual({
      status: "none",
    });
    expect(readPendingWarning(storage)).toEqual({ status: "none" });
  });

  it("reports a warning that could not be persisted instead of claiming it survived", () => {
    const storage = new FailingWriteStorage();
    savePendingAttempt(storage, attempt);
    storage.failWrites = true;

    const read = readPendingAttempt(
      storage,
      attempt.savedAt + PENDING_BOOKING_RETENTION_MS + 1,
    );

    expect(read).toEqual({ status: "expired", warningPersisted: false });
    expect(storage.getItem(PENDING_BOOKING_STORAGE_KEY)).not.toBeNull();
    expect(
      readPendingAttempt(
        storage,
        attempt.savedAt + PENDING_BOOKING_RETENTION_MS + 2,
      ),
    ).toEqual({ status: "expired", warningPersisted: false });
    expect(savePendingWarning(storage, "uncertain", attempt.savedAt)).toBe(
      false,
    );
    expect(
      resolveRecoveryRestore(read, readPendingWarning(storage)),
    ).toMatchObject({ status: "warning", notice: "expired", degraded: true });
  });

  it("keeps corrupt and legacy warnings on later reads", () => {
    const corruptStorage = new MemoryStorage();
    corruptStorage.setItem(PENDING_BOOKING_STORAGE_KEY, "{not json");

    expect(readPendingAttempt(corruptStorage, attempt.savedAt)).toEqual({
      status: "corrupt",
      warningPersisted: true,
    });
    expect(
      resolveRecoveryRestore(
        readPendingAttempt(corruptStorage, attempt.savedAt + 1_000),
        readPendingWarning(corruptStorage),
      ),
    ).toEqual({ status: "warning", notice: "corrupt", degraded: false });

    const legacyStorage = new MemoryStorage();
    legacyStorage.setItem(PENDING_BOOKING_STORAGE_KEY, RECOVERY_KEY);

    expect(readPendingAttempt(legacyStorage, attempt.savedAt)).toEqual({
      status: "legacy",
      warningPersisted: true,
    });
    expect(
      resolveRecoveryRestore(
        readPendingAttempt(legacyStorage, attempt.savedAt + 1_000),
        readPendingWarning(legacyStorage),
      ),
    ).toEqual({ status: "warning", notice: "legacy", degraded: false });
  });

  it("treats an unreadable warning record as a conservative corrupt warning", () => {
    const storage = new MemoryStorage();
    storage.setItem(PENDING_BOOKING_WARNING_STORAGE_KEY, "{not json");

    expect(readPendingWarning(storage)).toEqual({
      status: "found",
      warning: { kind: "corrupt", savedAt: 0 },
    });
  });

  it("does not let a warning write overwrite the recoverable attempt", () => {
    const storage = new MemoryStorage();
    savePendingAttempt(storage, attempt);
    savePendingWarning(storage, "uncertain", attempt.savedAt);

    expect(readPendingAttempt(storage, attempt.savedAt + 1_000)).toEqual({
      status: "saved",
      attempt,
    });
  });

  it("marks stored warnings unavailable when reading storage throws", () => {
    const unavailable = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };

    expect(readPendingWarning(unavailable)).toEqual({ status: "unavailable" });
    expect(
      resolveRecoveryRestore({ status: "none" }, { status: "unavailable" }),
    ).toMatchObject({ degraded: true });
  });
});

describe("public booking failure classification", () => {
  it("treats a fresh pre-replay denial as terminal for that new request", () => {
    expect(classifyBookingFailure("SHOP_PAUSED", false)).toBe("terminal");
    expect(classifyBookingFailure("VALIDATION_ERROR", false)).toBe("terminal");
  });

  it("keeps a prior unknown outcome ambiguous through pre-replay denials", () => {
    expect(classifyBookingFailure("SHOP_PAUSED", true)).toBe("unknown");
    expect(classifyBookingFailure("VALIDATION_ERROR", true)).toBe("unknown");
    expect(classifyBookingFailure("UNAVAILABLE", false)).toBe("unknown");
    expect(classifyBookingFailure("UNAVAILABLE", true)).toBe("unknown");
    expect(classifyBookingFailure(undefined, true)).toBe("unknown");
    expect(classifyBookingFailure(undefined, false)).toBe("unknown");
  });

  it("treats established post-replay denials as terminal", () => {
    expect(classifyBookingFailure("RATE_LIMITED", true)).toBe("terminal");
    expect(classifyBookingFailure("RATE_LIMITED", false)).toBe("terminal");
    expect(classifyBookingFailure("STALE_OFFER", true)).toBe("terminal");
    expect(classifyBookingFailure("UNAVAILABLE_INTERVAL", true)).toBe(
      "terminal",
    );
  });

  it("treats a recovery mismatch and unknown codes as ambiguous", () => {
    expect(classifyBookingFailure("RECOVERY_MISMATCH", true)).toBe("mismatch");
    expect(classifyBookingFailure("SOMETHING_NEW", true)).toBe("unknown");
    expect(classifyBookingFailure("SOMETHING_NEW", false)).toBe("unknown");
  });
});
