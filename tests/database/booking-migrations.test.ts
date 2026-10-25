import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../db/migrate.mts";
import { openTestDatabase } from "../support/database";

describe("public booking migration", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  const schema = `phase06_${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    database = await openTestDatabase();
    await applyMigrations(database.pool, "db/migrations");
    await database.pool.query(`CREATE SCHEMA ${schema}`);
    await database.pool.query(
      `CREATE TABLE ${schema}.shops (id text PRIMARY KEY)`,
    );
    await database.pool.query(
      `CREATE TABLE ${schema}.services (id text PRIMARY KEY, shop_id text NOT NULL REFERENCES ${schema}.shops(id), UNIQUE(shop_id,id))`,
    );
    await database.pool.query(
      `CREATE TABLE ${schema}.barbers (id text PRIMARY KEY, shop_id text NOT NULL REFERENCES ${schema}.shops(id), UNIQUE(shop_id,id))`,
    );
    await database.pool.query(
      `CREATE TABLE ${schema}.occupied_intervals (id uuid PRIMARY KEY)`,
    );
    await database.pool.query(
      `INSERT INTO ${schema}.shops VALUES ('shop-a'), ('shop-b')`,
    );
    await database.pool.query(
      `INSERT INTO ${schema}.services VALUES ('service-a','shop-a'), ('service-b','shop-b')`,
    );
    await database.pool.query(
      `INSERT INTO ${schema}.barbers VALUES ('barber-a','shop-a'), ('barber-b','shop-b')`,
    );
  });

  afterAll(async () => {
    await database?.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await database?.pool.end();
  });

  it("creates scoped booking history, recoverable capabilities, work, and shared rate records", async () => {
    const client = await database.pool.connect();
    await client.query(`SET search_path TO ${schema}, public`);
    try {
      await client.query(
        await readFile("db/migrations/0005_public_bookings.sql", "utf8"),
      );
      const bookingId = randomUUID();
      const occupancyId = randomUUID();
      await client.query("INSERT INTO occupied_intervals VALUES ($1)", [
        occupancyId,
      ]);
      const values = [
        bookingId,
        "shop-a",
        "service-a",
        "barber-a",
        occupancyId,
      ];
      await client.query(
        `INSERT INTO bookings (
        id, shop_id, service_id, barber_id, occupancy_id, start_at, end_at,
        service_name, service_price_usd, service_duration_minutes, barber_name,
        customer_name, customer_email, whatsapp_opt_in, capability_hash,
        capability_ciphertext, capability_key_id, recovery_key_hash, recovery_payload_digest
      ) VALUES ($1,$2,$3,$4,$5,'2026-11-02T10:00Z','2026-11-02T10:30Z','Cut',25,30,'Barber','Ada','ada@example.test',false,'token-hash','ciphertext','local-v1','recovery-hash','payload-digest')`,
        values,
      );
      await client.query(
        "INSERT INTO notification_work (id, booking_id, kind, channel, status) VALUES ($1,$2,'customer_confirmation','email','unavailable')",
        [randomUUID(), bookingId],
      );
      await client.query(
        "INSERT INTO public_rate_keys VALUES ('create_email_shop','email-hash')",
      );
      await client.query(
        "INSERT INTO public_rate_events (id,scope,key_hash) VALUES ($1,'create_email_shop','email-hash')",
        [randomUUID()],
      );
      await client.query(
        "INSERT INTO public_rate_keys VALUES ('create_ip','legacy-ip'), ('invalid_link_ip','legacy-probe')",
      );
      await client.query(
        "INSERT INTO public_rate_events (id,scope,key_hash) VALUES ($1,'create_ip','legacy-ip'), ($2,'invalid_link_ip','legacy-probe')",
        [randomUUID(), randomUUID()],
      );
      await client.query(
        await readFile("db/migrations/0006_remove_ip_rate_limits.sql", "utf8"),
      );
      await expect(
        client.query(
          "INSERT INTO public_rate_keys VALUES ('create_ip','ip-hash')",
        ),
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        (
          await client.query(
            "SELECT scope,key_hash FROM public_rate_keys ORDER BY scope",
          )
        ).rows,
      ).toEqual([{ scope: "create_email_shop", key_hash: "email-hash" }]);
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM public_rate_events",
          )
        ).rows[0].n,
      ).toBe(1);

      await expect(
        client.query(
          `INSERT INTO bookings (
        id, shop_id, service_id, barber_id, start_at, end_at,
        service_name, service_price_usd, service_duration_minutes, barber_name,
        customer_name, customer_email, whatsapp_opt_in, capability_hash,
        capability_ciphertext, capability_key_id, recovery_key_hash, recovery_payload_digest
      ) VALUES ($1,'shop-a','service-b','barber-a','2026-11-02T11:00Z','2026-11-02T11:30Z','Cut',25,30,'Barber','Ada','ada@example.test',false,'foreign-token','ciphertext','local-v1','foreign-recovery','digest')`,
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await client.query("DELETE FROM occupied_intervals WHERE id=$1", [
        occupancyId,
      ]);
      expect(
        (
          await client.query("SELECT occupancy_id FROM bookings WHERE id=$1", [
            bookingId,
          ])
        ).rows[0].occupancy_id,
      ).toBeNull();
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM notification_work WHERE booking_id=$1",
            [bookingId],
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await client.query("RESET search_path");
      client.release();
    }
  });
});
