ALTER TABLE booking_changes
  DROP CONSTRAINT booking_changes_kind_check,
  ADD CONSTRAINT booking_changes_kind_check CHECK (
    kind IN ('move', 'cancel', 'restore')
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
      'owner_move',
      'customer_restoration'
    )
  ),
  ADD CONSTRAINT notification_work_change_kind_check CHECK (
    (kind IN ('customer_move', 'customer_cancellation', 'customer_restoration') AND change_id IS NOT NULL AND booking_revision > 0)
    OR (kind IN ('owner_cancellation', 'owner_move') AND change_id IS NOT NULL AND booking_revision > 0 AND channel = 'email')
    OR (kind IN ('customer_confirmation', 'owner_alert') AND change_id IS NULL AND booking_revision = 0)
  );
