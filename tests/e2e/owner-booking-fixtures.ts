import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { decryptCapability } from "../../features/bookings/capabilities";
import type { Owner } from "./fixtures";

export async function seedOwnerAppointment(pool: Pool, owner: Owner) {
  const barberId = `barber-${randomUUID()}`;
  const serviceId = `service-${randomUUID()}`;
  const appointmentId = randomUUID();
  await pool.query(
    "INSERT INTO barbers (id,shop_id,name) VALUES ($1,$2,'Fictional Barber')",
    [barberId, owner.shopId],
  );
  await pool.query(
    "INSERT INTO services (id,shop_id,name,price_usd,duration_minutes,offered) VALUES ($1,$2,'Fictional Cut',25,35,true)",
    [serviceId, owner.shopId],
  );
  await pool.query(
    "INSERT INTO barber_services (shop_id,barber_id,service_id) VALUES ($1,$2,$3)",
    [owner.shopId, barberId, serviceId],
  );
  await pool.query(
    "INSERT INTO bookings (id,shop_id,service_id,barber_id,status,start_at,end_at,service_name,service_price_usd,service_duration_minutes,barber_name,customer_name,customer_email,customer_phone,whatsapp_opt_in,creation_source,capability_hash,capability_ciphertext,capability_key_id,recovery_key_hash,recovery_payload_digest) VALUES ($1,$2,$3,$4,'confirmed','2026-11-02T10:07:00Z','2026-11-02T10:42:00Z','Saved Cut',25,35,'Saved Barber','Fictional Guest',NULL,NULL,false,'owner',$5,$6,'test-v1',$7,$8)",
    [
      appointmentId,
      owner.shopId,
      serviceId,
      barberId,
      `hash-${randomUUID()}`,
      `ciphertext-${randomUUID()}`,
      `recovery-${randomUUID()}`,
      `digest-${randomUUID()}`,
    ],
  );
  return { appointmentId, barberId, serviceId };
}

export async function createOwnerAppointment(
  owner: Owner,
  startAt = "2027-01-19T13:07:00.000Z",
) {
  const { createOwnerBooking } =
    await import("../../features/bookings/mutations");
  const result = await createOwnerBooking(
    { userId: owner.id },
    {
      serviceId: owner.serviceId!,
      barberId: owner.barberId!,
      startAt,
      reviewedOffer: {
        name: "Walk-in Cut",
        priceUsd: "25.00",
        durationMinutes: "35",
      },
      contact: {
        name: "Move Journey Guest",
        email: `move-${randomBytes(6).toString("hex")}@example.test`,
        whatsappOptIn: false,
      },
      recoveryKey: randomBytes(32).toString("base64url"),
    },
  );
  if (!result.success) throw new Error("Valid appointment fixture failed.");
  return result.data.bookingId;
}

export async function createPastOwnerAppointment(
  pool: Pool,
  owner: Owner,
  now: Date,
) {
  const bookingId = await createOwnerAppointment(
    owner,
    new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
  );
  const endAt = new Date(now.getTime() - 60_000);
  const startAt = new Date(endAt.getTime() - 35 * 60_000);
  await pool.query(
    "UPDATE bookings SET start_at=$2,end_at=$3 WHERE id=$1 AND shop_id=$4",
    [bookingId, startAt.toISOString(), endAt.toISOString(), owner.shopId],
  );
  return bookingId;
}

export async function setFixtureAppointmentEnd(
  pool: Pool,
  owner: Owner,
  bookingId: string,
  endAt: Date,
) {
  const startAt = new Date(endAt.getTime() - 35 * 60_000);
  const result = await pool.query(
    "UPDATE bookings SET start_at=$3,end_at=$4 WHERE id=$1 AND shop_id=$2",
    [bookingId, owner.shopId, startAt.toISOString(), endAt.toISOString()],
  );
  if (result.rowCount !== 1)
    throw new Error("Owned appointment boundary fixture was not updated.");
}

export async function poisonOwnerAppointmentRead(
  pool: Pool,
  bookingId: string,
) {
  const result = await pool.query(
    "UPDATE notification_work SET updated_at='infinity' WHERE booking_id=$1 AND booking_revision=0 AND kind='customer_confirmation' AND channel='email'",
    [bookingId],
  );
  if (result.rowCount !== 1)
    throw new Error("Owned appointment read-failure fixture was not applied.");
}

export async function restoreOwnerAppointmentRead(
  pool: Pool,
  bookingId: string,
) {
  const result = await pool.query(
    "UPDATE notification_work SET updated_at=now() WHERE booking_id=$1 AND booking_revision=0 AND kind='customer_confirmation' AND channel='email'",
    [bookingId],
  );
  if (result.rowCount !== 1)
    throw new Error("Owned appointment read-failure fixture was not restored.");
}

export async function getOwnerManageToken(
  pool: Pool,
  owner: Owner,
  bookingId: string,
) {
  const result = await pool.query(
    "SELECT capability_ciphertext, capability_key_id FROM bookings WHERE id=$1 AND shop_id=$2",
    [bookingId, owner.shopId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Owned booking capability was not found.");
  return decryptCapability(
    row.capability_ciphertext,
    row.capability_key_id,
    `${owner.shopId}:${bookingId}`,
  );
}
