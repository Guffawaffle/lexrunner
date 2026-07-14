-- CHECK constraints below protect newly created databases. Existing version-2+
-- tables are not destructively rebuilt; runtime row validation provides their
-- fail-closed compatibility boundary.
CREATE TABLE IF NOT EXISTS attempts (
  attemptId TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  runRevision INTEGER NOT NULL CHECK (runRevision >= 0),
  workItemId TEXT NOT NULL,
  workItemRevision INTEGER NOT NULL CHECK (workItemRevision >= 0),
  packetId TEXT NOT NULL,
  packetHash TEXT NOT NULL,
  baseSha TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  status TEXT NOT NULL CHECK (status IN (
    'prepared', 'leased', 'launching', 'running', 'receipt_submitted', 'verifying', 'verified',
    'accepted', 'rejected', 'inconclusive', 'blocked', 'launch_failed', 'failed', 'cancelled',
    'quarantined'
  )),
  receiptId TEXT,
  verificationId TEXT,
  workspaceLeaseId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  completedAt TEXT,
  FOREIGN KEY (runId) REFERENCES run_coordination(runId) ON DELETE CASCADE
);

-- A work item can have historical attempts, but only one attempt that can still progress.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attempts_one_live_work_item
  ON attempts(runId, workItemId)
  WHERE status IN (
    'prepared', 'leased', 'launching', 'running', 'receipt_submitted', 'verifying', 'verified'
  );

CREATE TABLE IF NOT EXISTS workspace_leases (
  leaseId TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  runRevision INTEGER NOT NULL CHECK (runRevision >= 0),
  workItemId TEXT NOT NULL,
  workItemRevision INTEGER NOT NULL CHECK (workItemRevision >= 0),
  packetId TEXT NOT NULL,
  packetHash TEXT NOT NULL,
  attemptId TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  controllerId TEXT NOT NULL,
  controllerLeaseId TEXT NOT NULL,
  fencingToken INTEGER NOT NULL CHECK (fencingToken > 0),
  repositoryId TEXT NOT NULL,
  hostId TEXT NOT NULL,
  gitRuntime TEXT NOT NULL,
  projectRoot TEXT NOT NULL,
  branch TEXT NOT NULL,
  worktreePath TEXT NOT NULL,
  baseSha TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'reserved', 'active', 'released', 'preserved', 'abandoned', 'quarantined'
  )),
  acquiredAt TEXT NOT NULL,
  heartbeatAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  releasedAt TEXT,
  cleanupDisposition TEXT CHECK (
    cleanupDisposition IS NULL OR cleanupDisposition IN (
      'integrated', 'preserved', 'abandoned', 'discarded'
    )
  ),
  lastObservationJson TEXT,
  FOREIGN KEY (runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
  FOREIGN KEY (attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_leases_live_branch
  ON workspace_leases(repositoryId, branch)
  WHERE status IN ('reserved', 'active');
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_leases_live_worktree
  ON workspace_leases(hostId, gitRuntime, worktreePath)
  WHERE status IN ('reserved', 'active');
CREATE INDEX IF NOT EXISTS idx_workspace_leases_expiry
  ON workspace_leases(expiresAt) WHERE status IN ('reserved', 'active');

CREATE TABLE IF NOT EXISTS workspace_lifecycle_events (
  runId TEXT NOT NULL,
  attemptId TEXT NOT NULL,
  mutationId TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  attemptRevision INTEGER NOT NULL CHECK (attemptRevision >= 0),
  workspaceLeaseRevision INTEGER,
  controllerId TEXT NOT NULL,
  controllerLeaseId TEXT NOT NULL,
  fencingToken INTEGER NOT NULL CHECK (fencingToken > 0),
  type TEXT NOT NULL CHECK (type IN (
    'attempt_created', 'attempt_transitioned', 'workspace_acquired', 'workspace_heartbeat',
    'workspace_released', 'workspace_reconciled', 'workspace_quarantined'
  )),
  payloadJson TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (runId, mutationId),
  UNIQUE (runId, sequence),
  FOREIGN KEY (runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
  FOREIGN KEY (attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_lifecycle_mutations (
  runId TEXT NOT NULL,
  mutationId TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  resultJson TEXT NOT NULL,
  PRIMARY KEY (runId, mutationId),
  FOREIGN KEY (runId, mutationId)
    REFERENCES workspace_lifecycle_events(runId, mutationId) ON DELETE CASCADE
);

INSERT OR IGNORE INTO coordination_schema_migrations (version, name, appliedAt)
  VALUES (2, 'attempt-workspace-lifecycle', datetime('now'));
