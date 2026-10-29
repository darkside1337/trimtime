import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openTestDatabase } from "@/tests/support/database";
import { hashSecret } from "../capabilities";

type WorkKind =
  | "customer_confirmation"
  | "customer_move"
  | "customer_cancellation"
  | "owner_alert";

describe("booking notification reads", () => {
  const ids = {
    user: randomUUID(),
    shop: randomUUID(),
    barber: randomUUID(),
    service: randomUUID(),
  };
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let getManagedBooking: typeof import("../queries").getManagedBooking;
  let getOwnAppointment: typeof import("../queries").getOwnAppointment;

  beforeAll(async () => {
    database = await openTestDatabase();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T08:00:00Z"));
    ({ getManagedBooking, getOwnAppointment } = await import("../queries"));
    await database.pool.query(
      "INSERT INTO \"user\" (id,name,email) VALUES ($1,'Read Owner',$2)",
      [ids.user, `${ids.user}@example.test`],
    );
    await database.pool.query(
      "INSERT INTO shops (id,owner_id,name,subdomain,time_zone,public_contact,address,published) VALUES ($1,$2,'Current Shop',$3,'UTC','Call 555-0100','1 Sample Road',true)",
      [ids.shop, ids.user, `notification-${ids.shop.slice(0, 8)}`],
    );
    await database.pool.query(
      "INSERT INTO barbers (id,shop_id,name) VALUES ($1,$2,'Saved Barber')",
      [ids.barber, ids.shop],
    );
    await database.pool.query(
      "INSERT INTO services (id,shop_id,name,price_usd,duration_minutes) VALUES ($1,$2,'Saved Cut',25,30)",
      [ids.service, ids.shop],
    );
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (database) {
      await database.pool.query('DELETE FROM "user" WHERE id=$1', [ids.user]);
      await database.pool.end();
    }
  });

  async function createBooking(revision = 0) {
    const bookingId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    await database.pool.query(
      `INSERT INTO bookings (
        id, shop_id, service_id, barber_id, status, revision, start_at, end_at,
        service_name, service_price_usd, service_duration_minutes, barber_name,
        customer_name, customer_email, whatsapp_opt_in, created_at, capability_hash,
        capability_ciphertext, capability_key_id, recovery_key_hash, recovery_payload_digest
      ) VALUES ($1,$2,$3,$4,'confirmed',$5,'2026-11-02T10:00Z','2026-11-02T10:30Z','Saved Cut',25,30,'Saved Barber','Ada','ada@example.test',false,'2026-11-02T08:00Z',$6,'ciphertext','test-v1',$7,'payload-digest')`,
      [
        bookingId,
        ids.shop,
        ids.service,
        ids.barber,
        revision,
        hashSecret(token),
        hashSecret(randomUUID()),
      ],
    );
    return { bookingId, token };
  }

  async function addChange(
    bookingId: string,
    revision: number,
    kind: "move" | "cancel" = "move",
  ) {
    const changeId = randomUUID();
    await database.pool.query(
      `INSERT INTO booking_changes (
        id, shop_id, booking_id, actor_id, kind, applied_revision, committed_at,
        operation_key_hash, payload_digest, before_snapshot, after_snapshot
      ) VALUES ($1,$2,$3,$4,$5,$6,'2026-11-02T09:00Z',$7,$8,'{}'::jsonb,'{}'::jsonb)`,
      [
        changeId,
        ids.shop,
        bookingId,
        ids.user,
        kind,
        revision,
        hashSecret(randomUUID()),
        hashSecret(randomUUID()),
      ],
    );
    return changeId;
  }

  async function addWork(input: {
    bookingId: string;
    revision: number;
    kind: WorkKind;
    status: string;
    reason?: string | null;
    channel?: "email" | "whatsapp";
    changeId?: string | null;
    createdAt: Date;
    updatedAt?: Date;
    claimedAt?: Date | null;
  }) {
    await database.pool.query(
      `INSERT INTO notification_work (
        id, booking_id, booking_revision, change_id, kind, channel, status,
        reason, created_at, updated_at, claimed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        randomUUID(),
        input.bookingId,
        input.revision,
        input.changeId ?? null,
        input.kind,
        input.channel ?? "email",
        input.status,
        input.reason ?? null,
        input.createdAt,
        input.updatedAt ?? input.createdAt,
        input.claimedAt ?? null,
      ],
    );
  }

  async function expectEmail(
    bookingId: string,
    token: string,
    email: {
      status: string;
      reason: string | null;
      updatedAt: string | null;
    },
  ) {
    await expect(
      getOwnAppointment({ userId: ids.user }, bookingId),
    ).resolves.toMatchObject({
      success: true,
      data: { notifications: { email } },
    });
    await expect(
      getManagedBooking({ shopId: ids.shop }, token),
    ).resolves.toMatchObject({
      success: true,
      data: { notifications: { email } },
    });
  }

  it("reports missing email work as unavailable for both reads", async () => {
    const { bookingId, token } = await createBooking();
    await addWork({
      bookingId,
      revision: 0,
      kind: "owner_alert",
      status: "failed",
      reason: "permanent_rejection",
      createdAt: new Date("2026-11-02T08:03:00Z"),
    });

    await expectEmail(bookingId, token, {
      status: "unavailable",
      reason: null,
      updatedAt: null,
    });
  });

  it("ignores other channels and kinds for a revision-zero confirmation", async () => {
    const { bookingId, token } = await createBooking();
    await addWork({
      bookingId,
      revision: 0,
      kind: "customer_confirmation",
      status: "captured",
      createdAt: new Date("2026-11-02T08:01:00Z"),
    });
    await addWork({
      bookingId,
      revision: 0,
      kind: "customer_confirmation",
      channel: "whatsapp",
      status: "accepted",
      createdAt: new Date("2026-11-02T08:02:00Z"),
    });
    await addWork({
      bookingId,
      revision: 0,
      kind: "owner_alert",
      status: "failed",
      reason: "permanent_rejection",
      createdAt: new Date("2026-11-02T08:03:00Z"),
    });

    await expectEmail(bookingId, token, {
      status: "captured",
      reason: null,
      updatedAt: "2026-11-02T08:01:00.000Z",
    });
  });

  it("does not use a revision-zero confirmation after the booking changes", async () => {
    const { bookingId, token } = await createBooking(1);
    await addWork({
      bookingId,
      revision: 0,
      kind: "customer_confirmation",
      status: "captured",
      createdAt: new Date("2026-11-02T08:01:00Z"),
    });

    await expectEmail(bookingId, token, {
      status: "unavailable",
      reason: null,
      updatedAt: null,
    });
  });

  it("uses the current revision even when older work was created later", async () => {
    const { bookingId, token } = await createBooking(2);
    const currentChange = await addChange(bookingId, 2, "cancel");
    const olderChange = await addChange(bookingId, 1, "move");
    await addWork({
      bookingId,
      revision: 2,
      kind: "customer_cancellation",
      changeId: currentChange,
      status: "failed",
      reason: "permanent_rejection",
      createdAt: new Date("2026-11-02T08:01:00Z"),
    });
    await addWork({
      bookingId,
      revision: 1,
      kind: "customer_move",
      changeId: olderChange,
      status: "captured",
      createdAt: new Date("2026-11-02T08:02:00Z"),
    });

    await expectEmail(bookingId, token, {
      status: "failed",
      reason: "message_rejected",
      updatedAt: "2026-11-02T08:01:00.000Z",
    });
  });

  it("orders multiple matching rows for the current revision by creation time", async () => {
    const { bookingId, token } = await createBooking(1);
    const changeId = await addChange(bookingId, 1);
    await addWork({
      bookingId,
      revision: 1,
      kind: "customer_move",
      changeId,
      status: "accepted",
      createdAt: new Date("2026-11-02T08:01:00Z"),
    });
    await addWork({
      bookingId,
      revision: 1,
      kind: "customer_cancellation",
      changeId,
      status: "failed",
      reason: "permanent_rejection",
      createdAt: new Date("2026-11-02T08:02:00Z"),
    });

    await expectEmail(bookingId, token, {
      status: "failed",
      reason: "message_rejected",
      updatedAt: "2026-11-02T08:02:00.000Z",
    });
  });
});
