-- Approval queue lifecycle + Scriptorium's own review timestamps.
--
-- Proposal status now flows:
--   submitted -> approved (Approved · in queue) -> applied (Approved · applied)
--   plus: held, declined, superseded (merged into a newer proposal on the same file)
--
-- Article-level timestamps are Scriptorium's own record of when each file was last
-- put up for review / approved / applied. They are never pushed to the game.

ALTER TABLE articles ADD COLUMN review_requested_at INTEGER;
ALTER TABLE articles ADD COLUMN approved_at INTEGER;
ALTER TABLE articles ADD COLUMN applied_at INTEGER;

-- When a newer proposal merges/supersedes this one, point at it.
ALTER TABLE proposals ADD COLUMN superseded_by INTEGER;
