-- Conflict rejection + a knowledge base of "this wasn't a real conflict" feedback.
--
-- Rejecting a detected conflict records who/why on the conflict row (it drops off
-- the open list) AND appends a durable row to conflict_feedback. The detector reads
-- that table so a rejected finding is not re-flagged, and so we accumulate a signal
-- of where detection gets conflicts wrong. Never pushed to the game.

ALTER TABLE conflicts ADD COLUMN reject_reason TEXT;
ALTER TABLE conflicts ADD COLUMN rejected_by TEXT;
ALTER TABLE conflicts ADD COLUMN rejected_at INTEGER;

CREATE TABLE conflict_feedback (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint  TEXT,                 -- the conflict's stable id, so re-runs can skip it
  conflict_id  INTEGER,
  slug         TEXT NOT NULL,
  category     TEXT,
  title        TEXT,
  reason       TEXT NOT NULL,        -- why it was rejected (the learning signal)
  actor_id     TEXT,
  actor_name   TEXT,
  at           INTEGER NOT NULL
);
CREATE INDEX idx_conflict_feedback_fp ON conflict_feedback(fingerprint);
CREATE INDEX idx_conflict_feedback_slug ON conflict_feedback(slug);
