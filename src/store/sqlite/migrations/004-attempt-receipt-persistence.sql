CREATE TABLE IF NOT EXISTS attempt_receipts (
  receiptId TEXT PRIMARY KEY,
  receiptHash TEXT NOT NULL UNIQUE,
  receiptJson TEXT NOT NULL,
  runId TEXT NOT NULL,
  workItemId TEXT NOT NULL,
  workItemRevision INTEGER NOT NULL CHECK (workItemRevision >= 0),
  attemptId TEXT NOT NULL UNIQUE,
  packetId TEXT NOT NULL,
  packetHash TEXT NOT NULL,
  workspaceLeaseId TEXT NOT NULL,
  workspaceLeaseRevision INTEGER NOT NULL CHECK (workspaceLeaseRevision >= 0),
  workerSessionId TEXT NOT NULL,
  workerSessionRevision INTEGER NOT NULL CHECK (workerSessionRevision >= 0),
  workerRuntime TEXT NOT NULL,
  observedBaseSha TEXT NOT NULL,
  finalHeadSha TEXT,
  patchHash TEXT,
  outcome TEXT NOT NULL,
  disposition TEXT NOT NULL,
  submittedAt TEXT NOT NULL,
  recordedAt TEXT NOT NULL,
  controllerId TEXT NOT NULL,
  controllerLeaseId TEXT NOT NULL,
  fencingToken INTEGER NOT NULL CHECK (fencingToken > 0),
  resultingAttemptRevision INTEGER NOT NULL CHECK (resultingAttemptRevision >= 0),
  resultingAttemptStatus TEXT NOT NULL,
  FOREIGN KEY (runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
  FOREIGN KEY (attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE,
  FOREIGN KEY (workspaceLeaseId) REFERENCES workspace_leases(leaseId) ON DELETE RESTRICT,
  FOREIGN KEY (workerSessionId) REFERENCES worker_sessions(sessionId) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS attempt_receipt_events (
  runId TEXT NOT NULL,
  attemptId TEXT NOT NULL,
  receiptId TEXT NOT NULL,
  receiptHash TEXT NOT NULL,
  mutationId TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  attemptRevision INTEGER NOT NULL CHECK (attemptRevision >= 0),
  workspaceLeaseRevision INTEGER NOT NULL CHECK (workspaceLeaseRevision >= 0),
  workerSessionRevision INTEGER NOT NULL CHECK (workerSessionRevision >= 0),
  controllerId TEXT NOT NULL,
  controllerLeaseId TEXT NOT NULL,
  fencingToken INTEGER NOT NULL CHECK (fencingToken > 0),
  type TEXT NOT NULL,
  disposition TEXT NOT NULL,
  outcome TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (runId, mutationId),
  UNIQUE (runId, sequence),
  FOREIGN KEY (receiptId) REFERENCES attempt_receipts(receiptId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attempt_receipt_mutations (
  runId TEXT NOT NULL,
  mutationId TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  resultJson TEXT NOT NULL,
  PRIMARY KEY (runId, mutationId),
  FOREIGN KEY (runId, mutationId)
    REFERENCES attempt_receipt_events(runId, mutationId) ON DELETE CASCADE
);

INSERT OR IGNORE INTO coordination_schema_migrations (version, name, appliedAt)
  VALUES (4, 'attempt-receipt-persistence', datetime('now'));
