-- Applied programmatically for existing development databases. New databases
-- receive both evidence-binding columns in migration 012.
INSERT OR IGNORE INTO coordination_schema_migrations(version, name, appliedAt)
  VALUES (14, 'governed-attempt-evidence-binding', datetime('now'));
