CREATE TABLE IF NOT EXISTS run_coordination (
    runId TEXT PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    stateJson TEXT NOT NULL,
    fencingToken INTEGER NOT NULL DEFAULT 0 CHECK (fencingToken >= 0),
    controllerId TEXT,
    leaseId TEXT,
    acquiredAt TEXT,
    renewedAt TEXT,
    expiresAt TEXT,
    updatedAt TEXT NOT NULL,
    CHECK (
        (controllerId IS NULL AND leaseId IS NULL AND acquiredAt IS NULL AND renewedAt IS NULL AND expiresAt IS NULL)
        OR
        (controllerId IS NOT NULL AND leaseId IS NOT NULL AND acquiredAt IS NOT NULL AND renewedAt IS NOT NULL AND expiresAt IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_run_coordination_expiresAt
    ON run_coordination(expiresAt);

CREATE TABLE IF NOT EXISTS run_coordination_events (
    runId TEXT NOT NULL,
    mutationId TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    expectedRevision INTEGER NOT NULL CHECK (expectedRevision >= 0),
    controllerId TEXT NOT NULL,
    leaseId TEXT NOT NULL,
    fencingToken INTEGER NOT NULL CHECK (fencingToken > 0),
    type TEXT NOT NULL,
    payloadJson TEXT NOT NULL,
    resultingStateJson TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    PRIMARY KEY (runId, mutationId),
    UNIQUE (runId, revision),
    FOREIGN KEY (runId) REFERENCES run_coordination(runId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS coordination_schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    appliedAt TEXT NOT NULL
);

INSERT OR IGNORE INTO coordination_schema_migrations (version, name, appliedAt)
VALUES (1, 'controller-coordination', datetime('now'));
