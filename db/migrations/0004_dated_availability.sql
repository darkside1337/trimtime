CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE shop_date_schedules (
  shop_id text NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  date date NOT NULL,
  override jsonb,
  closed boolean NOT NULL DEFAULT false,
  revision integer NOT NULL CHECK (revision > 0),
  CONSTRAINT shop_date_schedules_pkey PRIMARY KEY (shop_id, date),
  CONSTRAINT shop_date_schedules_override_check CHECK (override IS NULL OR jsonb_typeof(override) = 'object')
);

CREATE TABLE barber_date_schedules (
  shop_id text NOT NULL,
  barber_id text NOT NULL,
  date date NOT NULL,
  override jsonb,
  closed boolean NOT NULL DEFAULT false,
  revision integer NOT NULL CHECK (revision > 0),
  CONSTRAINT barber_date_schedules_pkey PRIMARY KEY (shop_id, barber_id, date),
  CONSTRAINT barber_date_schedules_barber_fkey FOREIGN KEY (shop_id, barber_id) REFERENCES barbers(shop_id, id) ON DELETE CASCADE,
  CONSTRAINT barber_date_schedules_override_check CHECK (override IS NULL OR jsonb_typeof(override) = 'object')
);

CREATE TABLE occupied_intervals (
  id uuid PRIMARY KEY,
  shop_id text NOT NULL,
  barber_id text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  CONSTRAINT occupied_intervals_barber_fkey FOREIGN KEY (shop_id, barber_id) REFERENCES barbers(shop_id, id) ON DELETE CASCADE,
  CONSTRAINT occupied_intervals_valid_check CHECK (
    isfinite(start_at) AND isfinite(end_at) AND start_at < end_at AND
    extract(second FROM start_at) = 0 AND extract(second FROM end_at) = 0
  ),
  CONSTRAINT occupied_intervals_no_overlap EXCLUDE USING gist (
    shop_id WITH =, barber_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&
  )
);
CREATE INDEX occupied_intervals_shop_barber_start_idx ON occupied_intervals(shop_id, barber_id, start_at);

CREATE TABLE time_blocks (
  id uuid PRIMARY KEY REFERENCES occupied_intervals(id) ON DELETE CASCADE,
  note text NOT NULL DEFAULT ''
);
