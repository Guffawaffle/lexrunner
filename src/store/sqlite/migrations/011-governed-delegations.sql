CREATE TABLE IF NOT EXISTS governed_delegations (
  delegationId TEXT PRIMARY KEY,
  attemptId TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  status TEXT NOT NULL CHECK(status IN ('offered', 'accepted', 'declined')),
  offerHash TEXT NOT NULL,
  stateJson TEXT NOT NULL CHECK(length(stateJson) <= 262144),
  acceptanceReceiptHash TEXT,
  declineReceiptHash TEXT,
  declineReasonPresent INTEGER CHECK(declineReasonPresent IS NULL OR declineReasonPresent IN (0, 1)),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_governed_delegations_attempt
  ON governed_delegations(attemptId, createdAt, delegationId);

CREATE TABLE IF NOT EXISTS governed_delegation_events (
  delegationId TEXT NOT NULL,
  attemptId TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  delegationRevision INTEGER NOT NULL CHECK(delegationRevision >= 0),
  mutationId TEXT NOT NULL,
  mutationFingerprint TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    'delegation_offered',
    'delegation_accepted',
    'delegation_declined',
    'delegation_invocation_authorized',
    'delegation_invocation_denied'
  )),
  decisionReceiptHash TEXT,
  declineReasonPresent INTEGER CHECK(declineReasonPresent IS NULL OR declineReasonPresent IN (0, 1)),
  authorizationBindingHash TEXT,
  denialReason TEXT CHECK(denialReason IS NULL OR denialReason IN (
    'not_accepted', 'delegation_declined', 'binding_mismatch'
  )),
  createdAt TEXT NOT NULL,
  PRIMARY KEY(delegationId, sequence),
  UNIQUE(delegationId, mutationId),
  FOREIGN KEY(delegationId) REFERENCES governed_delegations(delegationId) ON DELETE RESTRICT
);

INSERT OR IGNORE INTO coordination_schema_migrations(version, name, appliedAt)
VALUES(11, 'governed-delegations', datetime('now'));
