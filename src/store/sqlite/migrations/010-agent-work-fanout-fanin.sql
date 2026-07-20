-- Runtime validation now permits multiple live Attempts only when every one
-- occupies a distinct premise in the same immutable fanout plan.
DROP INDEX IF EXISTS idx_attempts_one_live_work_item;
CREATE INDEX IF NOT EXISTS idx_attempts_live_work_item
  ON attempts(runId, workItemId)
  WHERE status IN (
    'prepared', 'leased', 'launching', 'running', 'receipt_submitted', 'verifying', 'verified'
  );

CREATE TABLE IF NOT EXISTS agent_work_fanout_plans (
  fanoutId TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  workItemId TEXT NOT NULL,
  workItemRevision INTEGER NOT NULL CHECK(workItemRevision >= 0),
  planHash TEXT NOT NULL,
  planJson TEXT NOT NULL CHECK(length(planJson) <= 262144),
  controllerId TEXT NOT NULL,
  controllerLeaseId TEXT NOT NULL,
  fencingToken INTEGER NOT NULL CHECK(fencingToken > 0),
  createdAt TEXT NOT NULL,
  FOREIGN KEY(runId) REFERENCES run_coordination(runId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_work_fanout_attempts (
  attemptId TEXT PRIMARY KEY,
  fanoutId TEXT NOT NULL,
  premiseId TEXT NOT NULL,
  premiseHash TEXT NOT NULL,
  planHash TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  UNIQUE(fanoutId, premiseId),
  FOREIGN KEY(fanoutId) REFERENCES agent_work_fanout_plans(fanoutId) ON DELETE RESTRICT,
  FOREIGN KEY(attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_work_fanin_decisions (
  decisionId TEXT PRIMARY KEY,
  fanoutId TEXT NOT NULL UNIQUE,
  runId TEXT NOT NULL,
  workItemId TEXT NOT NULL,
  workItemRevision INTEGER NOT NULL CHECK(workItemRevision >= 0),
  decisionHash TEXT NOT NULL,
  decisionJson TEXT NOT NULL CHECK(length(decisionJson) <= 262144),
  selectedAttemptId TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('selected', 'escalated', 'no_viable_candidate')),
  controllerId TEXT NOT NULL,
  controllerLeaseId TEXT NOT NULL,
  fencingToken INTEGER NOT NULL CHECK(fencingToken > 0),
  createdAt TEXT NOT NULL,
  FOREIGN KEY(fanoutId) REFERENCES agent_work_fanout_plans(fanoutId) ON DELETE RESTRICT,
  FOREIGN KEY(runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
  FOREIGN KEY(selectedAttemptId) REFERENCES attempts(attemptId) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS agent_work_fanout_mutations (
  runId TEXT NOT NULL,
  mutationId TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('plan', 'decision')),
  recordId TEXT NOT NULL,
  PRIMARY KEY(runId, mutationId),
  FOREIGN KEY(runId) REFERENCES run_coordination(runId) ON DELETE CASCADE
);

INSERT OR IGNORE INTO coordination_schema_migrations(version, name, appliedAt)
VALUES(10, 'agent-work-fanout-fanin', datetime('now'));
