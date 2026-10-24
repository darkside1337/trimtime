import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Owner } from "./fixtures";

export async function addReadyCatalog(pool: Pool, owner: Owner) {
  const barberId = randomUUID();
  const serviceId = randomUUID();
  const week = Array.from({ length: 7 }, (_, day) => ({
    working: day === 0 ? [{ start: 540, end: 600 }] : [],
    breaks: [],
  }));
  await pool.query(
    "INSERT INTO shop_schedules (shop_id, week, revision) VALUES ($1, $2::jsonb, 1)",
    [owner.shopId, JSON.stringify(week)],
  );
  await pool.query(
    "INSERT INTO barbers (id, shop_id, name) VALUES ($1, $2, 'Sam')",
    [barberId, owner.shopId],
  );
  await pool.query(
    "INSERT INTO barber_schedules (shop_id, barber_id, week, revision) VALUES ($1, $2, $3::jsonb, 1)",
    [owner.shopId, barberId, JSON.stringify(week)],
  );
  await pool.query(
    "INSERT INTO services (id, shop_id, name, price_usd, duration_minutes) VALUES ($1, $2, 'Cut', 35, 35)",
    [serviceId, owner.shopId],
  );
  await pool.query(
    "INSERT INTO barber_services (shop_id, barber_id, service_id) VALUES ($1, $2, $3)",
    [owner.shopId, barberId, serviceId],
  );
  return { barberId, serviceId };
}
