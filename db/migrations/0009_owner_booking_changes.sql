ALTER TABLE bookings ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD CONSTRAINT bookings_revision_check CHECK (revision >= 0);

CREATE TABLE booking_changes (
  id uuid PRIMARY KEY,
  shop_id text NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL,
  actor_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('move', 'cancel')),
  applied_revision integer NOT NULL CHECK (applied_revision > 0),
  committed_at timestamptz NOT NULL DEFAULT now(),
  operation_key_hash text NOT NULL,
  payload_digest text NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  CONSTRAINT booking_changes_shop_booking_fkey FOREIGN KEY (shop_id, booking_id) REFERENCES bookings(shop_id, id) ON DELETE CASCADE,
  CONSTRAINT booking_changes_shop_operation_key_key UNIQUE (shop_id, operation_key_hash),
  CONSTRAINT booking_changes_booking_revision_key UNIQUE (booking_id, applied_revision),
  CONSTRAINT booking_changes_id_booking_key UNIQUE (id, booking_id)
);

ALTER TABLE notification_work
  DROP CONSTRAINT notification_work_booking_kind_channel_key,
  DROP CONSTRAINT notification_work_kind_check,
  ADD COLUMN booking_revision integer NOT NULL DEFAULT 0 CHECK (booking_revision >= 0),
  ADD COLUMN change_id uuid,
  ADD CONSTRAINT notification_work_kind_check CHECK (kind IN ('customer_confirmation', 'owner_alert', 'customer_move', 'customer_cancellation')),
  ADD CONSTRAINT notification_work_change_kind_check CHECK (
    (kind IN ('customer_move', 'customer_cancellation') AND change_id IS NOT NULL AND booking_revision > 0)
    OR (kind IN ('customer_confirmation', 'owner_alert') AND change_id IS NULL AND booking_revision = 0)
  ),
  ADD CONSTRAINT notification_work_change_booking_fkey FOREIGN KEY (change_id, booking_id) REFERENCES booking_changes(id, booking_id) ON DELETE CASCADE,
  ADD CONSTRAINT notification_work_booking_kind_channel_key UNIQUE (booking_id, booking_revision, kind, channel);
