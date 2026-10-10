-- Richer conflict fields to carry the curated findings (citation line, the
-- proposed line-diff, and the label for the clean/ready-to-apply block).
ALTER TABLE conflicts ADD COLUMN cite TEXT;
ALTER TABLE conflicts ADD COLUMN diff TEXT;            -- JSON [[kind,gutter,text], ...]
ALTER TABLE conflicts ADD COLUMN suggested_label TEXT;
