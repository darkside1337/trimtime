import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
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
