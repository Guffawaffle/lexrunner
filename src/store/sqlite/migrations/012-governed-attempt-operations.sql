CREATE TABLE IF NOT EXISTS governed_attempt_operations (
  operationId TEXT PRIMARY KEY,
  attemptId TEXT NOT NULL,
  delegationId TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  status TEXT NOT NULL CHECK (status IN (
    'running', 'declined', 'completed', 'failed', 'cancelled', 'lost'
  )),
  createMutationId TEXT NOT NULL UNIQUE,
  createMutationFingerprint TEXT NOT NULL,
  handleJson TEXT NOT NULL CHECK (length(handleJson) <= 262144),
  authorizationJson TEXT NOT NULL CHECK (length(authorizationJson) <= 262144),
  evidenceReservationJson TEXT CHECK (
    evidenceReservationJson IS NULL OR length(evidenceReservationJson) <= 262144
  ),
  evidenceDeclarationJson TEXT CHECK (
    evidenceDeclarationJson IS NULL OR length(evidenceDeclarationJson) <= 262144
  ),
  verificationContextJson TEXT CHECK (
    verificationContextJson IS NULL OR length(verificationContextJson) <= 262144
  ),
  lastEventSequence INTEGER NOT NULL CHECK (lastEventSequence >= 0),
  resultJson TEXT CHECK (resultJson IS NULL OR length(resultJson) <= 262144),
  resultHash TEXT,
  verificationJson TEXT CHECK (
    verificationJson IS NULL OR length(verificationJson) <= 262144
  ),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  terminalAt TEXT,
  FOREIGN KEY (delegationId) REFERENCES governed_delegations(delegationId) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_governed_attempt_operations_delegation
  ON governed_attempt_operations(delegationId, createdAt, operationId);

CREATE TABLE IF NOT EXISTS governed_attempt_operation_events (
  operationId TEXT NOT NULL,
  attemptId TEXT NOT NULL,
  delegationId TEXT NOT NULL,
  operationRevision INTEGER NOT NULL CHECK (operationRevision > 0),
  mutationId TEXT NOT NULL,
  mutationFingerprint TEXT NOT NULL,
  executorSequence INTEGER NOT NULL CHECK (executorSequence > 0),
  eventJson TEXT NOT NULL CHECK (length(eventJson) <= 262144),
  createdAt TEXT NOT NULL,
  PRIMARY KEY (operationId, executorSequence),
  UNIQUE (mutationId),
  FOREIGN KEY (operationId) REFERENCES governed_attempt_operations(operationId) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS governed_attempt_operation_result_mutations (
  mutationId TEXT PRIMARY KEY,
  operationId TEXT NOT NULL,
  mutationFingerprint TEXT NOT NULL,
  FOREIGN KEY (operationId) REFERENCES governed_attempt_operations(operationId) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS governed_attempt_operation_verification_mutations (
  mutationId TEXT PRIMARY KEY,
  operationId TEXT NOT NULL,
  mutationFingerprint TEXT NOT NULL,
  FOREIGN KEY (operationId) REFERENCES governed_attempt_operations(operationId) ON DELETE RESTRICT
);

INSERT OR IGNORE INTO coordination_schema_migrations(version, name, appliedAt)
  VALUES (12, 'governed-attempt-operations', datetime('now'));
