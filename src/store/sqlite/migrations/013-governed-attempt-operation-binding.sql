-- Applied programmatically because SQLite has no ALTER TABLE ADD COLUMN IF NOT EXISTS.
-- New databases receive authorizationJson in migration 012; existing development
-- databases receive the nullable column before this marker is recorded.
INSERT OR IGNORE INTO coordination_schema_migrations(version, name, appliedAt)
  VALUES (13, 'governed-attempt-operation-binding', datetime('now'));
