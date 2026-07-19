CREATE TABLE IF NOT EXISTS attempt_verification_authorizations (
  verificationId TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  attemptId TEXT NOT NULL UNIQUE,
  attemptRevision INTEGER NOT NULL CHECK(attemptRevision >= 0),
  workspaceLeaseId TEXT NOT NULL,
  workspaceLeaseRevision INTEGER NOT NULL CHECK(workspaceLeaseRevision >= 0),
  workerSessionId TEXT NOT NULL,
  workerSessionRevision INTEGER NOT NULL CHECK(workerSessionRevision >= 0),
  receiptId TEXT NOT NULL UNIQUE,
  receiptHash TEXT NOT NULL,
  controllerId TEXT NOT NULL,
  controllerLeaseId TEXT NOT NULL,
  fencingToken INTEGER NOT NULL CHECK(fencingToken > 0),
  startedAt TEXT NOT NULL,
  FOREIGN KEY(runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
  FOREIGN KEY(attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE,
  FOREIGN KEY(workspaceLeaseId) REFERENCES workspace_leases(leaseId) ON DELETE RESTRICT,
  FOREIGN KEY(workerSessionId) REFERENCES worker_sessions(sessionId) ON DELETE RESTRICT,
  FOREIGN KEY(receiptId) REFERENCES attempt_receipts(receiptId) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS attempt_verifications (
  verificationId TEXT PRIMARY KEY,
  verificationHash TEXT NOT NULL UNIQUE,
  verificationJson TEXT NOT NULL,
  runId TEXT NOT NULL,
  workItemId TEXT NOT NULL,
  workItemRevision INTEGER NOT NULL CHECK(workItemRevision >= 0),
  attemptId TEXT NOT NULL UNIQUE,
  packetId TEXT NOT NULL,
  packetHash TEXT NOT NULL,
  workspaceLeaseId TEXT NOT NULL,
  workspaceLeaseRevision INTEGER NOT NULL CHECK(workspaceLeaseRevision >= 0),
  workerSessionId TEXT NOT NULL,
  workerSessionRevision INTEGER NOT NULL CHECK(workerSessionRevision >= 0),
  receiptId TEXT NOT NULL UNIQUE,
  receiptHash TEXT NOT NULL,
  observedBaseSha TEXT NOT NULL,
  verifiedHeadSha TEXT,
  verifiedPatchHash TEXT,
  workspaceObservationHash TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN (
    'pass', 'fail', 'inconclusive', 'infrastructure_error', 'cancelled'
  )),
  trustGapReasonsJson TEXT NOT NULL,
  verifierId TEXT NOT NULL,
  verifierVersion TEXT NOT NULL,
  startedAt TEXT NOT NULL,
  completedAt TEXT NOT NULL,
  recordedAt TEXT NOT NULL,
  controllerId TEXT NOT NULL,
  controllerLeaseId TEXT NOT NULL,
  fencingToken INTEGER NOT NULL CHECK(fencingToken > 0),
  resultingAttemptRevision INTEGER NOT NULL CHECK(resultingAttemptRevision >= 0),
  resultingAttemptStatus TEXT NOT NULL CHECK(resultingAttemptStatus IN (
    'prepared', 'leased', 'launching', 'running', 'receipt_submitted', 'verifying', 'verified',
    'accepted', 'rejected', 'inconclusive', 'blocked', 'launch_failed', 'failed', 'cancelled',
    'quarantined'
  )),
  FOREIGN KEY(runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
  FOREIGN KEY(attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE,
  FOREIGN KEY(workspaceLeaseId) REFERENCES workspace_leases(leaseId) ON DELETE RESTRICT,
  FOREIGN KEY(workerSessionId) REFERENCES worker_sessions(sessionId) ON DELETE RESTRICT,
  FOREIGN KEY(receiptId) REFERENCES attempt_receipts(receiptId) ON DELETE RESTRICT,
  FOREIGN KEY(verificationId) REFERENCES attempt_verification_authorizations(verificationId)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS attempt_verification_events (
  runId TEXT NOT NULL,
  attemptId TEXT NOT NULL,
  verificationId TEXT NOT NULL,
  verificationHash TEXT,
  receiptId TEXT NOT NULL,
  receiptHash TEXT NOT NULL,
  mutationId TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  attemptRevision INTEGER NOT NULL CHECK(attemptRevision >= 0),
  workspaceLeaseRevision INTEGER NOT NULL CHECK(workspaceLeaseRevision >= 0),
  workerSessionRevision INTEGER NOT NULL CHECK(workerSessionRevision >= 0),
  controllerId TEXT NOT NULL,
  controllerLeaseId TEXT NOT NULL,
  fencingToken INTEGER NOT NULL CHECK(fencingToken > 0),
  type TEXT NOT NULL CHECK(type IN (
    'attempt_verification_started', 'attempt_verification_recorded',
    'attempt_verification_replayed'
  )),
  outcome TEXT CHECK(outcome IN (
    'pass', 'fail', 'inconclusive', 'infrastructure_error', 'cancelled'
  )),
  resultingAttemptStatus TEXT NOT NULL CHECK(resultingAttemptStatus IN (
    'prepared', 'leased', 'launching', 'running', 'receipt_submitted', 'verifying', 'verified',
    'accepted', 'rejected', 'inconclusive', 'blocked', 'launch_failed', 'failed', 'cancelled',
    'quarantined'
  )),
  createdAt TEXT NOT NULL,
  PRIMARY KEY(runId, mutationId),
  UNIQUE(runId, sequence),
  FOREIGN KEY(verificationId) REFERENCES attempt_verification_authorizations(verificationId)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attempt_verification_begin_mutations (
  runId TEXT NOT NULL,
  mutationId TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  resultJson TEXT NOT NULL,
  PRIMARY KEY(runId, mutationId),
  FOREIGN KEY(runId, mutationId)
    REFERENCES attempt_verification_events(runId, mutationId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attempt_verification_mutations (
  runId TEXT NOT NULL,
  mutationId TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  resultJson TEXT NOT NULL,
  PRIMARY KEY(runId, mutationId),
  FOREIGN KEY(runId, mutationId)
    REFERENCES attempt_verification_events(runId, mutationId) ON DELETE CASCADE
);

INSERT OR IGNORE INTO coordination_schema_migrations(version, name, appliedAt)
VALUES(6, 'attempt-engine-verification-persistence', datetime('now'));
