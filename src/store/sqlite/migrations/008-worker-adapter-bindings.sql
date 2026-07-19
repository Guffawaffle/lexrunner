CREATE TABLE IF NOT EXISTS worker_adapter_bindings (
  sessionId TEXT PRIMARY KEY,
  adapterId TEXT NOT NULL CHECK(length(adapterId) BETWEEN 1 AND 128),
  adapterVersion TEXT NOT NULL CHECK(length(adapterVersion) BETWEEN 1 AND 128),
  enforcementSummaryHash TEXT NOT NULL,
  trustGapDimensionsJson TEXT NOT NULL CHECK(length(trustGapDimensionsJson) <= 4096),
  createdAt TEXT NOT NULL,
  FOREIGN KEY(sessionId) REFERENCES worker_sessions(sessionId) ON DELETE CASCADE
);

INSERT OR IGNORE INTO coordination_schema_migrations(version, name, appliedAt)
VALUES(8, 'worker-adapter-bindings', datetime('now'));
