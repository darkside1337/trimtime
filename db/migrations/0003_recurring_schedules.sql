CREATE TABLE shop_schedules (
  shop_id text PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  week jsonb NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  CONSTRAINT shop_schedules_week_check CHECK (jsonb_typeof(week) = 'array' AND jsonb_array_length(week) = 7)
);

CREATE TABLE barber_schedules (
  shop_id text NOT NULL,
  barber_id text NOT NULL,
  week jsonb NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  CONSTRAINT barber_schedules_pkey PRIMARY KEY (shop_id, barber_id),
  CONSTRAINT barber_schedules_barber_fkey FOREIGN KEY (shop_id, barber_id) REFERENCES barbers(shop_id, id) ON DELETE CASCADE,
  CONSTRAINT barber_schedules_week_check CHECK (jsonb_typeof(week) = 'array' AND jsonb_array_length(week) = 7)
);
