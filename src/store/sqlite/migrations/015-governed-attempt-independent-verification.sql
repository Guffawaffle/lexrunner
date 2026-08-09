-- Applied programmatically for existing databases. New databases receive the
-- verifier context, receipt, and mutation table in migration 012.
INSERT OR IGNORE INTO coordination_schema_migrations(version, name, appliedAt)
  VALUES (15, 'governed-attempt-independent-verification', datetime('now'));
