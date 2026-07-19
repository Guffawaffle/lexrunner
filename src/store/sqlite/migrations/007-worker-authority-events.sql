CREATE TABLE IF NOT EXISTS worker_authority_events (
  runId TEXT NOT NULL,
  attemptId TEXT NOT NULL,
  workerSessionId TEXT NOT NULL,
  mutationId TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  attemptRevision INTEGER NOT NULL CHECK(attemptRevision >= 0),
  workspaceLeaseId TEXT NOT NULL,
  workspaceLeaseRevision INTEGER NOT NULL CHECK(workspaceLeaseRevision >= 0),
  workerSessionRevision INTEGER NOT NULL CHECK(workerSessionRevision >= 0),
  packetId TEXT NOT NULL,
  packetHash TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK(dimension IN (
    'edit', 'git_write', 'github_write', 'external_runtime', 'secrets', 'signing', 'release'
  )),
  decision TEXT NOT NULL CHECK(decision IN ('allowed', 'denied', 'deviation')),
  enforcement TEXT NOT NULL CHECK(enforcement IN ('enforced', 'brokered', 'unenforced')),
  actionClass TEXT NOT NULL CHECK(length(actionClass) BETWEEN 1 AND 128),
  actionHash TEXT NOT NULL,
  backendId TEXT NOT NULL CHECK(length(backendId) BETWEEN 1 AND 128),
  backendVersion TEXT NOT NULL CHECK(length(backendVersion) BETWEEN 1 AND 128),
  reason TEXT NOT NULL CHECK(reason IN (
    'packet_granted', 'packet_denied', 'backend_unenforceable', 'observed_after_execution'
  )),
  controllerId TEXT NOT NULL,
  controllerLeaseId TEXT NOT NULL,
  fencingToken INTEGER NOT NULL CHECK(fencingToken > 0),
  createdAt TEXT NOT NULL,
  PRIMARY KEY(runId, mutationId),
  UNIQUE(runId, sequence),
  FOREIGN KEY(runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
  FOREIGN KEY(attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE,
  FOREIGN KEY(workspaceLeaseId) REFERENCES workspace_leases(leaseId) ON DELETE RESTRICT,
  FOREIGN KEY(workerSessionId) REFERENCES worker_sessions(sessionId) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_worker_authority_events_attempt
ON worker_authority_events(runId, attemptId, sequence);

INSERT OR IGNORE INTO coordination_schema_migrations(version, name, appliedAt)
VALUES(7, 'worker-authority-events', datetime('now'));
