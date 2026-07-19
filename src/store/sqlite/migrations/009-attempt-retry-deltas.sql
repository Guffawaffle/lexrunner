CREATE TABLE IF NOT EXISTS attempt_retry_deltas (
  attemptId TEXT PRIMARY KEY,
  previousAttemptId TEXT NOT NULL,
  deltaHash TEXT NOT NULL,
  deltaJson TEXT NOT NULL CHECK(length(deltaJson) <= 262144),
  createdAt TEXT NOT NULL,
  FOREIGN KEY(attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE,
  FOREIGN KEY(previousAttemptId) REFERENCES attempts(attemptId) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attempt_retry_deltas_previous
ON attempt_retry_deltas(previousAttemptId, attemptId);

INSERT OR IGNORE INTO coordination_schema_migrations(version, name, appliedAt)
VALUES(9, 'attempt-retry-deltas', datetime('now'));
