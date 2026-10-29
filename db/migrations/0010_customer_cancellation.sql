ALTER TABLE booking_changes
  ADD COLUMN actor_type text NOT NULL DEFAULT 'owner',
  ALTER COLUMN actor_id DROP NOT NULL;

ALTER TABLE booking_changes
  ADD CONSTRAINT booking_changes_actor_type_check
    CHECK (actor_type IN ('owner', 'customer')),
  ADD CONSTRAINT booking_changes_actor_check CHECK (
    (actor_type = 'owner' AND actor_id IS NOT NULL)
    OR (actor_type = 'customer' AND actor_id IS NULL AND kind = 'cancel')
  );

ALTER TABLE public_rate_keys
  DROP CONSTRAINT public_rate_keys_scope_check,
  ADD CONSTRAINT public_rate_keys_scope_check CHECK (
    scope IN ('create_email_shop', 'customer_change_link')
  );

ALTER TABLE notification_work
  DROP CONSTRAINT notification_work_kind_check,
  DROP CONSTRAINT notification_work_change_kind_check,
  ADD CONSTRAINT notification_work_kind_check CHECK (
    kind IN (
      'customer_confirmation',
      'owner_alert',
      'customer_move',
      'customer_cancellation',
      'owner_cancellation'
    )
  ),
  ADD CONSTRAINT notification_work_change_kind_check CHECK (
    (kind IN ('customer_move', 'customer_cancellation') AND change_id IS NOT NULL AND booking_revision > 0)
    OR (kind = 'owner_cancellation' AND change_id IS NOT NULL AND booking_revision > 0 AND channel = 'email')
    OR (kind IN ('customer_confirmation', 'owner_alert') AND change_id IS NULL AND booking_revision = 0)
  );
