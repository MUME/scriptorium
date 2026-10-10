-- Behind-the-scenes login log: one row per successful Discord sign-in.
-- Append-only; never shown to the person signing in. Approver-only to read.

CREATE TABLE login_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id  TEXT NOT NULL,
  username    TEXT NOT NULL,
  tier        TEXT NOT NULL,           -- member | council | approver, at the time of login
  at          INTEGER NOT NULL         -- unix seconds
);
CREATE INDEX idx_login_events_at ON login_events(at DESC);
CREATE INDEX idx_login_events_who ON login_events(discord_id, at DESC);
