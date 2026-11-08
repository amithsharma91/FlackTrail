/**
 * Persistence adapter for Hindsight usage records using SQLite.
 *
 * Implements the UsagePersistence interface so that usage records
 * (RETAIN, RECALL, REFLECT) survive backend restarts.
 *
 * Also implements atomic reflection reservations using SQLite transactions
 * (BEGIN IMMEDIATE) to prevent check-then-act race conditions across
 * concurrent requests and multiple backend processes sharing the same DB.
 */

import { DatabaseSync } from 'node:sqlite';
import { UsageRecord, UsagePersistence, ReflectLimitConfig } from '../usage';

export class SqliteUsagePersistence implements UsagePersistence {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async loadRecords(): Promise<UsageRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT operation, timestamp, token_count, estimated_cost, success, error
         FROM usage_records
         ORDER BY timestamp ASC`
      )
      .all() as any[];

    return rows.map((row) => ({
      operation: row.operation as 'retain' | 'recall' | 'reflect',
      timestamp: row.timestamp,
      tokenCount: row.token_count ?? undefined,
      estimatedCost: row.estimated_cost,
      success: row.success === 1,
      error: row.error ?? undefined,
    }));
  }

  async saveRecord(record: UsageRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO usage_records (operation, timestamp, token_count, estimated_cost, success, error)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.operation,
        record.timestamp,
        record.tokenCount ?? null,
        record.estimatedCost,
        record.success ? 1 : 0,
        record.error ?? null
      );
  }

  async clearRecords(): Promise<void> {
    this.db.prepare(`DELETE FROM usage_records`).run();
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Reflection reservation (atomic via SQLite BEGIN IMMEDIATE)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Atomically reserve a REFLECT call slot using SQLite BEGIN IMMEDIATE.
   *
   * BEGIN IMMEDIATE acquires a write lock immediately, preventing other
   * processes from starting a write transaction until this one commits.
   * This makes the check-and-reserve atomic across processes.
   *
   * @param estimatedCost - Estimated cost of the REFLECT call ($0.05)
   * @param currentReflectCount - Current count of reflect operations (from UsageTracker)
   * @param currentSpend - Current total spend in USD (from UsageTracker)
   * @param limits - Reflect call limit and monthly budget
   * @returns Reservation ID if allowed, null if blocked.
   */
  async reserveReflect(
    estimatedCost: number,
    currentReflectCount: number,
    currentSpend: number,
    limits: ReflectLimitConfig,
  ): Promise<string | null> {
    // BEGIN IMMEDIATE acquires a write lock immediately.
    this.db.exec('BEGIN IMMEDIATE');

    try {
      // Count pending + completed reservations within this transaction.
      const pendingReservations = this.db
        .prepare(
          `SELECT COUNT(*) as c FROM reflect_reservations WHERE status IN ('pending', 'completed')`
        )
        .get() as { c: number };
      const reservationCount = pendingReservations.c;

      const totalReflects = currentReflectCount + reservationCount;

      // Check call limit.
      if (totalReflects >= limits.reflectCallLimit) {
        this.db.exec('ROLLBACK');
        return null;
      }

      // Check budget.
      const projectedSpend = currentSpend + estimatedCost;
      if (limits.monthlyBudgetUsd > 0 && projectedSpend > limits.monthlyBudgetUsd) {
        this.db.exec('ROLLBACK');
        return null;
      }

      // Insert pending reservation.
      const id = `reflect-res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();

      this.db
        .prepare(
          `INSERT INTO reflect_reservations (id, created_at, status, estimated_cost)
           VALUES (?, ?, 'pending', ?)`
        )
        .run(id, now, estimatedCost);

      this.db.exec('COMMIT');
      return id;
    } catch (err) {
      // Ensure we don't leave a transaction open.
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ROLLBACK may fail if already committed/rolled back.
      }
      throw err;
    }
  }

  /**
   * Mark a reservation as completed (external REFLECT was attempted).
   */
  async confirmReflect(reservationId: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE reflect_reservations SET status = 'completed' WHERE id = ?`
      )
      .run(reservationId);
  }

  /**
   * Cancel a pending reservation without recording usage.
   */
  async releaseReflect(reservationId: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE reflect_reservations SET status = 'released' WHERE id = ? AND status = 'pending'`
      )
      .run(reservationId);
  }

  /**
   * Load all pending reservations (for recovery after restart).
   */
  async loadPendingReservations(): Promise<Array<{ id: string; estimated_cost: number }>> {
    const rows = this.db
      .prepare(
        `SELECT id, estimated_cost FROM reflect_reservations WHERE status = 'pending'`
      )
      .all() as Array<{ id: string; estimated_cost: number }>;
    return rows;
  }
}
