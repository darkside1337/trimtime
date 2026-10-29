ALTER TABLE booking_changes
  DROP CONSTRAINT booking_changes_actor_check,
  ADD CONSTRAINT booking_changes_actor_check CHECK (
    (actor_type = 'owner' AND actor_id IS NOT NULL)
    OR (actor_type = 'customer' AND actor_id IS NULL AND kind IN ('cancel', 'move'))
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
      'owner_cancellation',
      'owner_move'
    )
  ),
  ADD CONSTRAINT notification_work_change_kind_check CHECK (
    (kind IN ('customer_move', 'customer_cancellation') AND change_id IS NOT NULL AND booking_revision > 0)
    OR (kind IN ('owner_cancellation', 'owner_move') AND change_id IS NOT NULL AND booking_revision > 0 AND channel = 'email')
    OR (kind IN ('customer_confirmation', 'owner_alert') AND change_id IS NULL AND booking_revision = 0)
  );
