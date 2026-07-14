CREATE TABLE IF NOT EXISTS worker_sessions (
  sessionId TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  runId TEXT NOT NULL,
  attemptId TEXT NOT NULL,
  packetId TEXT NOT NULL,
  packetHash TEXT NOT NULL,
  workspaceLeaseId TEXT NOT NULL,
  workspaceLeaseRevision INTEGER NOT NULL CHECK (workspaceLeaseRevision >= 0),
  executionEnvelopeId TEXT NOT NULL,
  executionEnvelopeHash TEXT NOT NULL,
  hostId TEXT NOT NULL,
  workerRuntime TEXT NOT NULL,
  gitRuntime TEXT NOT NULL,
  backend TEXT NOT NULL CHECK (backend IN ('host-subagent', 'codex-cli', 'external')),
  workerId TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'starting', 'running', 'awaiting_human', 'completed', 'failed', 'cancelled', 'lost'
  )),
  startedAt TEXT NOT NULL,
  heartbeatAt TEXT NOT NULL,
  endedAt TEXT,
  exitReason TEXT,
  exitCode INTEGER,
  exitSummary TEXT,
  FOREIGN KEY (runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
  FOREIGN KEY (attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE,
  FOREIGN KEY (workspaceLeaseId) REFERENCES workspace_leases(leaseId) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS launch_envelope_bindings (
  attemptId TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  workspaceLeaseId TEXT NOT NULL,
  attemptRevision INTEGER NOT NULL CHECK (attemptRevision >= 0),
  workspaceLeaseRevision INTEGER NOT NULL CHECK (workspaceLeaseRevision >= 0),
  authorizationMutationId TEXT NOT NULL,
  envelopeId TEXT NOT NULL UNIQUE,
  envelopeHash TEXT NOT NULL,
  envelopeJson TEXT NOT NULL,
  controllerId TEXT NOT NULL,
  controllerLeaseId TEXT NOT NULL,
  fencingToken INTEGER NOT NULL CHECK (fencingToken > 0),
  createdAt TEXT NOT NULL,
  FOREIGN KEY (attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE,
  FOREIGN KEY (workspaceLeaseId) REFERENCES workspace_leases(leaseId) ON DELETE RESTRICT,
  FOREIGN KEY (runId, authorizationMutationId)
    REFERENCES workspace_lifecycle_events(runId, mutationId) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_sessions_one_nonterminal_attempt
  ON worker_sessions(attemptId)
  WHERE status IN ('starting', 'running', 'awaiting_human');
CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_sessions_one_live_native_identity
  ON worker_sessions(hostId, backend, workerId)
  WHERE status IN ('starting', 'running', 'awaiting_human');

CREATE TABLE IF NOT EXISTS worker_session_events (
  runId TEXT NOT NULL,
  attemptId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  mutationId TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  attemptRevision INTEGER NOT NULL CHECK (attemptRevision >= 0),
  workspaceLeaseRevision INTEGER NOT NULL CHECK (workspaceLeaseRevision >= 0),
  sessionRevision INTEGER NOT NULL CHECK (sessionRevision >= 0),
  controllerId TEXT NOT NULL,
  controllerLeaseId TEXT NOT NULL,
  fencingToken INTEGER NOT NULL CHECK (fencingToken > 0),
  type TEXT NOT NULL CHECK (type IN (
    'worker_session_attached', 'worker_session_heartbeat', 'worker_session_ended'
  )),
  payloadJson TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (runId, mutationId),
  UNIQUE (runId, sequence),
  FOREIGN KEY (runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
  FOREIGN KEY (attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE,
  FOREIGN KEY (sessionId) REFERENCES worker_sessions(sessionId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS worker_session_mutations (
  runId TEXT NOT NULL,
  mutationId TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  resultJson TEXT NOT NULL,
  PRIMARY KEY (runId, mutationId),
  FOREIGN KEY (runId, mutationId)
    REFERENCES worker_session_events(runId, mutationId) ON DELETE CASCADE
);

INSERT OR IGNORE INTO coordination_schema_migrations (version, name, appliedAt)
  VALUES (3, 'worker-session-lifecycle', datetime('now'));
