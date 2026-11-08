/**
 * Database initialization and connection management for FlakeTrail.
 *
 * Uses the built-in Node.js SQLite module (node:sqlite) with DatabaseSync.
 * Database path is configurable via DATABASE_PATH env var, defaults to
 * ./data/flakeTrail.db. The parent directory is created automatically.
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Global database instance. Initialized once at startup.
 */
let db: DatabaseSync | null = null;

/**
 * Initialize the SQLite database connection.
 *
 * @param dbPath - Path to the SQLite database file. Defaults to
 *   ./data/flakeTrail.db if DATABASE_PATH env var is not set.
 * @returns The initialized DatabaseSync instance.
 * @throws Error if the database cannot be opened or initialized.
 */
export function initDatabase(dbPath?: string): DatabaseSync {
  if (db) {
    return db;
  }

  const resolvedPath = dbPath || process.env.DATABASE_PATH || './data/flakeTrail.db';

  // Create the parent directory automatically if it doesn't exist
  const parentDir = path.dirname(resolvedPath);
  fs.mkdirSync(parentDir, { recursive: true });

  db = new DatabaseSync(resolvedPath);

  // Enable WAL mode for better concurrent read/write performance
  db.exec('PRAGMA journal_mode = WAL');
  // Enable foreign key constraints
  db.exec('PRAGMA foreign_keys = ON');

  return db;
}

/**
 * Get the initialized database instance.
 *
 * @returns The DatabaseSync instance.
 * @throws Error if the database has not been initialized.
 */
export function getDatabase(): DatabaseSync {
  if (!db) {
    throw new Error(
      'Database not initialized. Call initDatabase() before accessing the database.'
    );
  }
  return db;
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
