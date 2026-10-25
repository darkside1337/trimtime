CREATE TABLE bookings (
  id uuid PRIMARY KEY,
  shop_id text NOT NULL,
  service_id text NOT NULL,
  barber_id text NOT NULL,
  occupancy_id uuid UNIQUE REFERENCES occupied_intervals(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  service_name text NOT NULL,
  service_price_usd numeric NOT NULL CHECK (service_price_usd >= 0 AND service_price_usd < 'Infinity'::numeric AND scale(service_price_usd) <= 2),
  service_duration_minutes integer NOT NULL CHECK (service_duration_minutes >= 30),
  barber_name text NOT NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text,
  whatsapp_opt_in boolean NOT NULL,
  whatsapp_consent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  capability_hash text NOT NULL UNIQUE,
  capability_ciphertext text NOT NULL,
  capability_key_id text NOT NULL,
  capability_revoked_at timestamptz,
  recovery_key_hash text NOT NULL,
  recovery_payload_digest text NOT NULL,
  CONSTRAINT bookings_shop_id_id_key UNIQUE (shop_id, id),
  CONSTRAINT bookings_shop_fkey FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  CONSTRAINT bookings_service_fkey FOREIGN KEY (shop_id, service_id) REFERENCES services(shop_id, id),
  CONSTRAINT bookings_barber_fkey FOREIGN KEY (shop_id, barber_id) REFERENCES barbers(shop_id, id),
  CONSTRAINT bookings_shop_recovery_key_key UNIQUE (shop_id, recovery_key_hash),
  CONSTRAINT bookings_interval_check CHECK (isfinite(start_at) AND isfinite(end_at) AND start_at < end_at),
  CONSTRAINT bookings_whatsapp_consent_check CHECK (NOT whatsapp_opt_in OR (customer_phone IS NOT NULL AND whatsapp_consent_at IS NOT NULL))
);
CREATE INDEX bookings_shop_start_idx ON bookings(shop_id, start_at);

CREATE TABLE notification_work (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('customer_confirmation', 'owner_alert')),
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  status text NOT NULL CHECK (status IN ('unavailable', 'not_attempted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_work_booking_kind_channel_key UNIQUE (booking_id, kind, channel)
);

CREATE TABLE public_rate_keys (
  scope text NOT NULL CHECK (scope IN ('create_ip', 'create_email_shop', 'invalid_link_ip')),
  key_hash text NOT NULL,
  PRIMARY KEY (scope, key_hash)
);

CREATE TABLE public_rate_events (
  id uuid PRIMARY KEY,
  scope text NOT NULL,
  key_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_rate_events_key_fkey FOREIGN KEY (scope, key_hash) REFERENCES public_rate_keys(scope, key_hash) ON DELETE CASCADE
);
CREATE INDEX public_rate_events_scope_key_created_idx ON public_rate_events(scope, key_hash, created_at);
