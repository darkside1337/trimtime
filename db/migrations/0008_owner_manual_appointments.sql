ALTER TABLE bookings ALTER COLUMN customer_email DROP NOT NULL;
ALTER TABLE bookings ADD COLUMN creation_source text NOT NULL DEFAULT 'public';
ALTER TABLE bookings ADD CONSTRAINT bookings_creation_source_check
  CHECK (creation_source IN ('public', 'owner'));
