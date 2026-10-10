-- TEST reviewer support: tag every action a test reviewer takes so it can be
-- reverted in one click ("Undo test activity") without touching real reviewers' work.

ALTER TABLE decisions ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conflict_feedback ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
