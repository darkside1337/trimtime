ALTER TABLE notification_work
  DROP CONSTRAINT notification_work_status_check,
  ADD CONSTRAINT notification_work_status_check
    CHECK (status IN ('unavailable', 'not_attempted', 'sending', 'accepted', 'captured', 'failed', 'skipped', 'suppressed', 'unknown')),
  ADD COLUMN recipient text,
  ADD COLUMN content_identity text,
  ADD COLUMN reason text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN claim_id uuid;

UPDATE notification_work
SET reason = 'legacy_unavailable'
WHERE status = 'unavailable';

CREATE INDEX notification_work_booking_created_idx
  ON notification_work (booking_id, created_at);

CREATE TABLE outbound_budget (
  day date PRIMARY KEY,
  allocation_count integer NOT NULL DEFAULT 0 CHECK (allocation_count BETWEEN 0 AND 100)
);

CREATE TABLE notification_attempts (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL UNIQUE REFERENCES notification_work(id) ON DELETE CASCADE,
  budget_day date NOT NULL REFERENCES outbound_budget(day),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  invoked_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('accepted', 'captured', 'failed', 'unknown')),
  capture_id text,
  CONSTRAINT notification_attempts_id_work_key UNIQUE (id, work_id)
);

CREATE UNIQUE INDEX notification_work_claim_id_key
  ON notification_work (claim_id) WHERE claim_id IS NOT NULL;
