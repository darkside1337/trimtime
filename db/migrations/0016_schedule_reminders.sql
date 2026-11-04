ALTER TABLE notification_work
  ADD COLUMN due_at timestamptz,
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
      'customer_restoration',
      'customer_reminder'
    )
  ),
  ADD CONSTRAINT notification_work_change_kind_check CHECK (
    (
      kind IN ('customer_move', 'customer_cancellation', 'customer_restoration')
      AND change_id IS NOT NULL
      AND booking_revision > 0
    )
    OR (
      kind IN ('owner_cancellation', 'owner_move')
      AND change_id IS NOT NULL
      AND booking_revision > 0
      AND channel = 'email'
    )
    OR (
      kind IN ('customer_confirmation', 'owner_alert')
      AND change_id IS NULL
      AND booking_revision = 0
    )
    OR (
      kind = 'customer_reminder'
      AND (
        (change_id IS NULL AND booking_revision = 0)
        OR (change_id IS NOT NULL AND booking_revision > 0)
      )
    )
  ),
  ADD CONSTRAINT notification_work_due_at_check CHECK (
    (kind = 'customer_reminder' AND due_at IS NOT NULL)
    OR (kind <> 'customer_reminder' AND due_at IS NULL)
  );

CREATE INDEX notification_work_customer_reminder_due_idx
  ON notification_work (due_at, id)
  WHERE kind = 'customer_reminder'
    AND channel = 'email'
    AND status = 'not_attempted';
