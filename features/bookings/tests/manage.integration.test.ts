import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openTestDatabase } from "@/tests/support/database";
import { hashSecret } from "../capabilities";

describe("managed booking reads", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let getManagedBooking: typeof import("../queries").getManagedBooking;
  const ids = {
    user: randomUUID(),
    shop: randomUUID(),
    barber: randomUUID(),
    service: randomUUID(),
    booking: randomUUID(),
    notification: randomUUID(),
    ownerNotification: randomUUID(),
  };
  const token = randomBytes(32).toString("base64url");

  beforeAll(async () => {
    database = await openTestDatabase();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T08:00:00Z"));
    ({ getManagedBooking } = await import("../queries"));
    await database.pool.query(
      "INSERT INTO \"user\" (id,name,email) VALUES ($1,'Read Owner',$2)",
      [ids.user, `${ids.user}@example.test`],
    );
    await database.pool.query(
      "INSERT INTO shops (id,owner_id,name,subdomain,time_zone,public_contact,address,published) VALUES ($1,$2,'Current Shop',$3,'UTC','Call 555-0100','1 Sample Road',false)",
      [ids.shop, ids.user, `manage-${ids.shop.slice(0, 8)}`],
    );
    await database.pool.query(
      "INSERT INTO barbers (id,shop_id,name) VALUES ($1,$2,'Saved Barber')",
      [ids.barber, ids.shop],
    );
    await database.pool.query(
      "INSERT INTO services (id,shop_id,name,price_usd,duration_minutes) VALUES ($1,$2,'Saved Cut',25,30)",
      [ids.service, ids.shop],
    );
    await database.pool.query(
      `INSERT INTO bookings (
      id, shop_id, service_id, barber_id, status, start_at, end_at,
      service_name, service_price_usd, service_duration_minutes, barber_name,
      customer_name, customer_email, whatsapp_opt_in, created_at, capability_hash,
      capability_ciphertext, capability_key_id, recovery_key_hash, recovery_payload_digest
    ) VALUES ($1,$2,$3,$4,'confirmed','2026-11-02T10:00Z','2026-11-02T10:30Z','Saved Cut',25,30,'Saved Barber','Ada','ada@example.test',false,'2026-11-02T08:00Z',$5,'ciphertext','test-v1','recovery-hash','payload-digest')`,
      [ids.booking, ids.shop, ids.service, ids.barber, hashSecret(token)],
    );
    await database.pool.query(
      "INSERT INTO notification_work (id, booking_id, kind, channel, status, recipient) VALUES ($1,$2,'customer_confirmation','email','captured','ada@example.test')",
      [ids.notification, ids.booking],
    );
    await database.pool.query(
      "INSERT INTO notification_work (id, booking_id, kind, channel, status, recipient) VALUES ($1,$2,'owner_alert','email','failed',$3)",
      [ids.ownerNotification, ids.booking, `${ids.user}@example.test`],
    );
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (database) {
      await database.pool.query('DELETE FROM "user" WHERE id=$1', [ids.user]);
      await database.pool.end();
    }
  });

  it("includes the saved revision for explicit customer confirmation", async () => {
    await expect(
      getManagedBooking({ shopId: ids.shop }, token),
    ).resolves.toMatchObject({
      success: true,
      data: {
        revision: 0,
        status: "confirmed",
        startAt: "2026-11-02T10:00:00.000Z",
        endAt: "2026-11-02T10:30:00.000Z",
      },
    });
  });

  it("returns only the scoped saved details without mutation, and hides invalid tokens", async () => {
    const context = { shopId: ids.shop };
    const before = await database.pool.query(
      "SELECT count(*)::int AS bookings FROM bookings WHERE id=$1",
      [ids.booking],
    );
    await expect(getManagedBooking(context, token)).resolves.toMatchObject({
      success: true,
      data: {
        shop: { name: "Current Shop", address: "1 Sample Road" },
        service: { name: "Saved Cut" },
        barber: { name: "Saved Barber" },
        customer: { name: "Ada" },
      },
    });
    await expect(
      getManagedBooking({ ...context, shopId: randomUUID() }, token),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE" },
    });
    await expect(
      getManagedBooking(context, `${token.slice(0, -1)}x`),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE" },
    });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS bookings FROM bookings WHERE id=$1",
          [ids.booking],
        )
      ).rows[0].bookings,
    ).toBe(before.rows[0].bookings);
  });

  it("keeps invalid links uniformly unavailable without limiting valid reads", async () => {
    const context = { shopId: ids.shop };
    for (let probe = 0; probe < 20; probe++) {
      await expect(
        getManagedBooking(context, `invalid-${probe}`),
      ).resolves.toMatchObject({
        success: false,
        error: { code: "UNAVAILABLE" },
      });
    }
    await expect(getManagedBooking(context, token)).resolves.toMatchObject({
      success: true,
      data: { shop: { name: "Current Shop" } },
    });
  });

  it("returns the customer confirmation status through the capability read", async () => {
    const result = await getManagedBooking({ shopId: ids.shop }, token);
    expect(result).toMatchObject({
      success: true,
      data: { notifications: { email: { status: "captured" } } },
    });
    expect(JSON.stringify(result)).not.toContain(`${ids.user}@example.test`);
  });

  it("hides customer status when the capability has been revoked", async () => {
    await database.pool.query(
      "UPDATE bookings SET capability_revoked_at=now() WHERE id=$1",
      [ids.booking],
    );
    await expect(
      getManagedBooking({ shopId: ids.shop }, token),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE" },
    });
  });

  it("denies access at exactly the saved end plus 168 elapsed hours", async () => {
    vi.setSystemTime(new Date("2026-11-09T10:30:00Z"));
    await expect(
      getManagedBooking({ shopId: ids.shop }, token),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "UNAVAILABLE" },
    });
  });
});
