ALTER TABLE notification_attempts
  DROP CONSTRAINT notification_attempts_work_id_key,
  ADD COLUMN attempt_number integer NOT NULL DEFAULT 1,
  ADD COLUMN reason text,
  ADD COLUMN finished_at timestamptz,
  ADD CONSTRAINT notification_attempts_work_attempt_number_key
    UNIQUE (work_id, attempt_number),
  ADD CONSTRAINT notification_attempts_attempt_number_check
    CHECK (attempt_number BETWEEN 1 AND 3);

ALTER TABLE notification_work
  ADD COLUMN next_attempt_at timestamptz;

UPDATE notification_attempts AS attempt
SET reason = work.reason,
    finished_at = work.updated_at
FROM notification_work AS work
WHERE attempt.work_id = work.id
  AND attempt.outcome = 'failed'
  AND work.status = 'failed';

UPDATE notification_work AS work
SET next_attempt_at = attempt.finished_at + interval '10 minutes'
FROM notification_attempts AS attempt
WHERE attempt.work_id = work.id
  AND work.channel = 'email'
  AND work.status = 'failed'
  AND work.reason = 'transient_rejection'
  AND attempt.attempt_number = 1
  AND attempt.reason = 'transient_rejection'
  AND attempt.finished_at IS NOT NULL;

CREATE INDEX notification_work_next_attempt_at_idx
  ON notification_work (next_attempt_at, id)
  WHERE next_attempt_at IS NOT NULL;
