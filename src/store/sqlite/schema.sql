-- SqliteRunStore Schema
-- Version: 1.0.0
-- 
-- This schema supports the RunStore interface for run lifecycle persistence.
-- All timestamps are stored as UTC ISO 8601 strings (YYYY-MM-DDTHH:mm:ss.sssZ).

-- Enable foreign key enforcement
PRAGMA foreign_keys = ON;

-- Runs table: stores run records
CREATE TABLE IF NOT EXISTS runs (
    runId TEXT PRIMARY KEY,
    planHash TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'completed', 'failed', 'aborted')),
    startedAt TEXT NOT NULL,
    completedAt TEXT,
    metadata TEXT  -- JSON-encoded arbitrary metadata
);

-- Index for filtering runs by state
CREATE INDEX IF NOT EXISTS idx_runs_state ON runs(state);

-- Index for ordering runs by start time
CREATE INDEX IF NOT EXISTS idx_runs_startedAt ON runs(startedAt);

-- Steps table: stores step outcomes
CREATE TABLE IF NOT EXISTS steps (
    stepId TEXT PRIMARY KEY,
    runId TEXT NOT NULL,
    nodeId TEXT NOT NULL,
    gateName TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'skipped', 'blocked')),
    durationMs INTEGER NOT NULL,
    logs TEXT,
    artifacts TEXT,  -- JSON-encoded array of artifact paths
    timestamp TEXT NOT NULL,
    FOREIGN KEY (runId) REFERENCES runs(runId) ON DELETE CASCADE
);

-- Index for looking up steps by runId
CREATE INDEX IF NOT EXISTS idx_steps_runId ON steps(runId);

-- Index for ordering steps by timestamp
CREATE INDEX IF NOT EXISTS idx_steps_timestamp ON steps(timestamp);

-- Receipts table: stores scope/risk escalation receipts
CREATE TABLE IF NOT EXISTS receipts (
    receiptId TEXT PRIMARY KEY,
    runId TEXT NOT NULL,
    reason TEXT NOT NULL,
    approver TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (runId) REFERENCES runs(runId) ON DELETE CASCADE
);

-- Index for looking up receipts by runId
CREATE INDEX IF NOT EXISTS idx_receipts_runId ON receipts(runId);

-- Schema version for migrations
CREATE TABLE IF NOT EXISTS schema_version (
    version TEXT PRIMARY KEY,
    appliedAt TEXT NOT NULL
);

-- Insert initial version if not present
INSERT OR IGNORE INTO schema_version (version, appliedAt) 
VALUES ('1.0.0', datetime('now'));
