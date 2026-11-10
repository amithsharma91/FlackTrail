import { DatabaseSync } from 'node:sqlite';

/**
 * Database schema definitions for FlakeTrail.
 *
 * All schema changes are versioned. Each migration is idempotent and uses
 * CREATE TABLE IF NOT EXISTS so it can be safely run multiple times.
 *
 * Schema version history:
 *   v1: Initial schema with incidents and usage_records tables.
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
-- Incidents table: stores CI failure investigations
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  test_name TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_type TEXT,
  stack_trace TEXT,
  failure_signature TEXT NOT NULL,
  environment TEXT,
  file_paths TEXT,
  timestamp TEXT,
  ci_job_id TEXT,
  ci_branch TEXT,
  raw_log_excerpt TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  outcome TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ai_analysis TEXT,
  historical_investigations TEXT
);

CREATE INDEX IF NOT EXISTS idx_incidents_failure_signature ON incidents(failure_signature);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at);

-- Usage records table: tracks Hindsight memory operations for cost tracking
CREATE TABLE IF NOT EXISTS usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL CHECK (operation IN ('retain', 'recall', 'reflect')),
  timestamp TEXT NOT NULL,
  token_count INTEGER,
  estimated_cost REAL NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 1,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_records_operation ON usage_records(operation);
CREATE INDEX IF NOT EXISTS idx_usage_records_timestamp ON usage_records(timestamp);

-- Reflect reservations: atomic reservation of REFLECT call slots
-- Prevents check-then-act race conditions across concurrent requests
-- and multiple backend processes sharing the same database.
CREATE TABLE IF NOT EXISTS reflect_reservations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'released')),
  estimated_cost REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reflect_reservations_status ON reflect_reservations(status);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

INSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION})
ON CONFLICT(version) DO NOTHING;
`;

export function initSchema(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);

  // Idempotent column migrations for existing databases created before the
  // ai_analysis / historical_investigations columns were added. SQLite does
  // not support "ADD COLUMN IF NOT EXISTS", so each ALTER TABLE is wrapped in
  // try/catch (a duplicate-column error is safe to ignore).
  try {
    db.exec(`ALTER TABLE incidents ADD COLUMN ai_analysis TEXT`);
  } catch {
    // Column already exists; safe to ignore.
  }
  try {
    db.exec(`ALTER TABLE incidents ADD COLUMN historical_investigations TEXT`);
  } catch {
    // Column already exists; safe to ignore.
  }
}