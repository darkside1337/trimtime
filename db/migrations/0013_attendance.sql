ALTER TABLE bookings
  DROP CONSTRAINT bookings_status_check,
  ADD CONSTRAINT bookings_status_check CHECK (
    status IN ('confirmed', 'cancelled', 'completed', 'no_show')
  );

ALTER TABLE booking_changes
  DROP CONSTRAINT booking_changes_kind_check,
  ADD CONSTRAINT booking_changes_kind_check CHECK (
    kind IN ('move', 'cancel', 'restore', 'attendance')
  );
