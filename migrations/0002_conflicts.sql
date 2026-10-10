-- Detected conflicts / audit findings, raised by the check engine (detect.mjs).
-- Re-populated after each crawl. These are the "Workflow" queue (Area 1).

CREATE TABLE conflicts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,        -- conflict | quality | stale
  slug        TEXT NOT NULL,        -- the target article
  title       TEXT NOT NULL,
  kicker      TEXT,
  standing    TEXT,                 -- one-line summary of the issue
  src_a_name  TEXT, src_a_body TEXT,
  src_b_name  TEXT, src_b_body TEXT,
  note        TEXT,
  checks      TEXT,                 -- JSON [{severity,label,detail}]
  suggested   TEXT,                 -- optional suggested replacement body
  fingerprint TEXT UNIQUE,          -- stable id so re-runs don't duplicate
  status      TEXT NOT NULL DEFAULT 'open',  -- open | dismissed | proposed
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_conflicts_cat ON conflicts(category, status);
