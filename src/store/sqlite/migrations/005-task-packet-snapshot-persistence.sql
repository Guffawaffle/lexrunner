CREATE TABLE IF NOT EXISTS task_packet_bindings (
  attemptId TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  workItemId TEXT NOT NULL,
  workItemRevision INTEGER NOT NULL CHECK (workItemRevision >= 0),
  packetId TEXT NOT NULL,
  packetHash TEXT NOT NULL,
  packetJson TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
  FOREIGN KEY (attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE
);

INSERT OR IGNORE INTO coordination_schema_migrations (version, name, appliedAt)
  VALUES (5, 'task-packet-snapshot-persistence', datetime('now'));
