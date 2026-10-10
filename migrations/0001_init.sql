-- Scriptorium — initial schema (core loop: corpus, proposals, decisions, users).
-- Check-engine tables (facts, announcements, change_entries) are added later.

CREATE TABLE articles (
  slug         TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  aliases      TEXT,                 -- JSON array of alias slugs
  field_block  TEXT,                 -- structured field block, or NULL
  body         TEXT NOT NULL,        -- full help text as shown in game
  body_hash    TEXT NOT NULL,
  links        TEXT,                 -- JSON array of See-Also / inline slugs
  status       TEXT NOT NULL DEFAULT 'live',   -- live | new | changed | removed
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL
);
CREATE INDEX idx_articles_title ON articles(title);
CREATE INDEX idx_articles_status ON articles(status);

-- Every observed change to an article body, append-only (change detection).
CREATE TABLE article_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL,
  body       TEXT NOT NULL,
  body_hash  TEXT NOT NULL,
  seen_at    INTEGER NOT NULL
);
CREATE INDEX idx_history_slug ON article_history(slug);

-- A proposed edit to an article. body_before is the article body at propose time.
CREATE TABLE proposals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL,
  author_id    TEXT NOT NULL,
  author_name  TEXT NOT NULL,
  kind         TEXT NOT NULL,        -- correction | propagation | clarity | keyword
  rationale    TEXT NOT NULL,
  body_before  TEXT NOT NULL,
  body_after   TEXT NOT NULL,
  note_review  TEXT,                 -- optional "NOTE FOR REVIEW", excluded from copy
  status       TEXT NOT NULL DEFAULT 'submitted', -- draft|submitted|approved|declined|held|applied
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_proposals_slug ON proposals(slug);
CREATE INDEX idx_proposals_status ON proposals(status);

-- Automated check results attached to a proposal (check engine, populated later).
CREATE TABLE proposal_checks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id  INTEGER NOT NULL,
  check_key    TEXT NOT NULL,
  severity     TEXT NOT NULL,        -- ok | warn | error
  detail       TEXT
);
CREATE INDEX idx_checks_proposal ON proposal_checks(proposal_id);

-- Append-only audit of every decision on a proposal.
CREATE TABLE decisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id  INTEGER NOT NULL,
  actor_id     TEXT NOT NULL,
  actor_name   TEXT NOT NULL,
  verdict      TEXT NOT NULL,        -- approved | declined | held | applied | reopened
  note         TEXT,
  decided_at   INTEGER NOT NULL
);
CREATE INDEX idx_decisions_proposal ON decisions(proposal_id);

CREATE TABLE users (
  discord_id  TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  tier        TEXT NOT NULL DEFAULT 'member', -- member | approver
  roles_json  TEXT,
  last_seen   INTEGER NOT NULL
);
