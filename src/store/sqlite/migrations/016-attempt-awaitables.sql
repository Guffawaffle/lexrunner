CREATE TABLE IF NOT EXISTS attempt_awaitables (
  awaitableId TEXT PRIMARY KEY,
  attemptId TEXT NOT NULL,
  workerSessionId TEXT,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  status TEXT NOT NULL CHECK(status IN (
    'registered','observing','satisfied','terminal_failed','deadline','cancelled',
    'subject_drift','observation_error'
  )),
  deadlineAt TEXT NOT NULL,
  observerLeaseExpiresAt TEXT,
  deliveryStatus TEXT CHECK(deliveryStatus IS NULL OR deliveryStatus IN ('pending','delivered')),
  recordJson TEXT NOT NULL CHECK(length(recordJson) <= 262144),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  terminalAt TEXT,
  FOREIGN KEY(attemptId) REFERENCES attempts(attemptId) ON DELETE RESTRICT,
  FOREIGN KEY(workerSessionId) REFERENCES worker_sessions(sessionId) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_attempt_awaitables_recovery
  ON attempt_awaitables(status, observerLeaseExpiresAt, createdAt, awaitableId);
CREATE INDEX IF NOT EXISTS idx_attempt_awaitables_delivery
  ON attempt_awaitables(deliveryStatus, terminalAt, awaitableId);
CREATE INDEX IF NOT EXISTS idx_attempt_awaitables_target
  ON attempt_awaitables(attemptId, workerSessionId, createdAt, awaitableId);

CREATE TABLE IF NOT EXISTS attempt_awaitable_events (
  awaitableId TEXT NOT NULL,
  attemptId TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  awaitableRevision INTEGER NOT NULL CHECK(awaitableRevision >= 0),
  mutationId TEXT NOT NULL UNIQUE,
  mutationFingerprint TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    'awaitable_registered','awaitable_observation_claimed','awaitable_observation_released',
    'awaitable_terminal_recorded','awaitable_delivery_attempted',
    'awaitable_delivery_acknowledged'
  )),
  payloadJson TEXT NOT NULL CHECK(length(payloadJson) <= 262144),
  createdAt TEXT NOT NULL,
  PRIMARY KEY(awaitableId, sequence),
  FOREIGN KEY(awaitableId) REFERENCES attempt_awaitables(awaitableId) ON DELETE RESTRICT
);

INSERT OR IGNORE INTO coordination_schema_migrations(version, name, appliedAt)
VALUES(16, 'attempt-awaitables', datetime('now'));
