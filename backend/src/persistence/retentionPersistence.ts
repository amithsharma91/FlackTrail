/**
 * Persistence adapter for Hindsight retention tracking.
 *
 * Implements the HindsightPersistence interface using SQLite to persist
 * duplicate-retention tracking across backend restarts.
 */

import { DatabaseSync } from 'node:sqlite';
import { HindsightPersistence } from '../hindsight/service';

export class SQLiteRetentionPersistence implements HindsightPersistence {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS retention_ledger (
        key TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    ).run();
  }

  async isRetentionRecorded(key: string): Promise<boolean> {
    const row = this.db.prepare(
      `SELECT 1 FROM retention_ledger WHERE key = ? LIMIT 1`
    ).get(key) as any;
    return !!row;
  }

  async recordRetention(key: string): Promise<void> {
    this.db.prepare(
      `INSERT OR IGNORE INTO retention_ledger (key) VALUES (?)`
    ).run(key);
  }

  async clearRetentionLedger(): Promise<void> {
    this.db.prepare(`DELETE FROM retention_ledger`).run();
  }
}