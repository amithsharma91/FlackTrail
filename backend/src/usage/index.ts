/**
 * Hindsight usage tracker.
 *
 * Tracks RETAIN, RECALL, and REFLECT operations locally for cost estimation.
 * This is NOT authoritative billing - it is a local estimate only.
 * Actual billing is determined by Hindsight Cloud.
 *
 * Persistence: an optional `UsagePersistence` adapter can be supplied so that
 * usage records survive backend restarts. Records are loaded asynchronously on
 * construction and each new record is saved to the persistence layer.
 */

import {
  estimateRecallCost,
  estimateReflectCost,
  estimateRetainCost,
  HINDSIGHT_COSTS,
} from './costs';

export {
  estimateRecallCost,
  estimateReflectCost,
  estimateRetainCost,
  HINDSIGHT_COSTS,
} from './costs';

export interface UsageRecord {
  operation: 'retain' | 'recall' | 'reflect';
  timestamp: string;
  tokenCount?: number; // measured when SDK returns it, undefined otherwise
  estimatedCost: number; // local estimate
  success: boolean;
  error?: string;
  timeout?: boolean; // true when the operation timed out and remote outcome is unknown
}

export interface UsagePersistence {
  loadRecords(): Promise<UsageRecord[]>;
  saveRecord(record: UsageRecord): Promise<void>;
  clearRecords(): Promise<void>;
  // Reflection reservation (atomic, cross-process safe with SQLite).
  // reserveReflect atomically checks limits and creates a pending reservation.
  // Returns a reservation ID if allowed, null if blocked.
  // With SQLite persistence, the check-and-insert happens inside a
  // BEGIN IMMEDIATE transaction for cross-process atomicity.
  reserveReflect(
    estimatedCost: number,
    currentReflectCount: number,
    currentSpend: number,
    limits: ReflectLimitConfig,
  ): Promise<string | null>;
  // confirmReflect marks a reservation as completed and records usage.
  confirmReflect(reservationId: string, success: boolean, error?: string, timeout?: boolean): Promise<void>;
  // releaseReflect cancels a pending reservation without recording usage.
  releaseReflect(reservationId: string): Promise<void>;
  // Load pending reservations for recovery after restart.
  loadPendingReservations(): Promise<Array<{ id: string; estimated_cost: number }>>;
}

export interface UsageSnapshot {
  retainCount: number;
  recallCount: number;
  reflectCount: number;
  totalEstimatedCost: number;
  totalEstimatedRetainCost: number;
  totalEstimatedRecallCost: number;
  totalEstimatedReflectCost: number;
  lastOperationTimestamp?: string;
  errors: number;
  measuredTokenCount: number; // sum of token counts when SDK returned them
  estimatedTokenCount: number; // sum of estimated tokens when SDK did not return them
}

export interface UsageTrackerConfig {
  monthlyBudgetUsd: number;
  reflectCallLimit: number;
}

export const DEFAULT_USAGE_CONFIG: UsageTrackerConfig = {
  monthlyBudgetUsd: 4.75, // current Hindsight Cloud available balance
  reflectCallLimit: 10,
};

export interface ReflectLimitConfig {
  reflectCallLimit: number;
  monthlyBudgetUsd: number;
}

export class UsageTracker {
  private records: UsageRecord[] = [];
  private config: UsageTrackerConfig;
  private persistence?: UsagePersistence;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  // In-memory reflection reservations (used when no persistence adapter).
  // JS is single-threaded per event loop, so this is race-free within a process.
  private reflectReservations: Map<string, { status: 'pending' | 'completed' | 'released'; estimatedCost: number }> = new Map();
  private reflectReservationCounter = 0;

  constructor(
    config: Partial<UsageTrackerConfig> = {},
    persistence?: UsagePersistence
  ) {
    this.config = {
      monthlyBudgetUsd: DEFAULT_USAGE_CONFIG.monthlyBudgetUsd,
      reflectCallLimit: DEFAULT_USAGE_CONFIG.reflectCallLimit,
      ...config,
    };
    this.persistence = persistence;

    // No async work in the constructor. Initialization happens exclusively
    // through init() to avoid a race between the constructor's fire-and-forget
    // loadRecords() and an explicit init() call.
    if (!this.persistence) {
      this.records = [];
      this.initialized = true;
    }
  }

  /**
   * Initialize the tracker by loading historical records from persistence.
   * Must be called and awaited before calling any other method.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.initPromise = this.loadRecords();
    await this.initPromise;
    this.initialized = true;

    // Release any pending reservations from a previous session.
    // They never made it to the external API, so they should not count
    // against limits or budget after a restart.
    if (this.persistence) {
      try {
        const pending = await this.persistence.loadPendingReservations();
        for (const r of pending) {
          await this.persistence.releaseReflect(r.id);
        }
      } catch {
        // Persistence recovery failure is non-fatal.
      }
    } else {
      // Release all in-memory pending reservations.
      for (const [id, res] of this.reflectReservations) {
        if (res.status === 'pending') {
          res.status = 'released';
        }
      }
    }
  }

  private async loadRecords(): Promise<void> {
    if (this.persistence) {
      try {
        this.records = await this.persistence.loadRecords();
      } catch {
        this.records = [];
      }
    } else {
      this.records = [];
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'UsageTracker not initialized. Call init() before using the tracker.'
      );
    }
  }

  recordRetain(tokenCount?: number, success = true, error?: string, timeout = false): void {
    this.ensureInitialized();
    const estimatedCost = tokenCount
      ? estimateRetainCost(tokenCount)
      : estimateRetainCost(0); // fallback: 0 tokens = $0 estimate
    const record: UsageRecord = {
      operation: 'retain',
      timestamp: new Date().toISOString(),
      tokenCount,
      estimatedCost,
      success,
      error,
      timeout,
    };
    this.records.push(record);
    if (this.persistence) {
      this.persistence.saveRecord(record).catch(() => {
        // Persistence save failure is non-fatal; record is still tracked in memory.
      });
    }
  }

  recordRecall(tokenCount?: number, success = true, error?: string, timeout = false): void {
    this.ensureInitialized();
    const estimatedCost = tokenCount
      ? estimateRecallCost(tokenCount)
      : estimateRecallCost(0);
    const record: UsageRecord = {
      operation: 'recall',
      timestamp: new Date().toISOString(),
      tokenCount,
      estimatedCost,
      success,
      error,
      timeout,
    };
    this.records.push(record);
    if (this.persistence) {
      this.persistence.saveRecord(record).catch(() => {
        // Persistence save failure is non-fatal; record is still tracked in memory.
      });
    }
  }

  recordReflect(tokenCount?: number, success = true, error?: string, timeout = false): void {
    this.ensureInitialized();
    const estimatedCost = estimateReflectCost();
    const record: UsageRecord = {
      operation: 'reflect',
      timestamp: new Date().toISOString(),
      tokenCount,
      estimatedCost,
      success,
      error,
      timeout,
    };
    this.records.push(record);
    if (this.persistence) {
      this.persistence.saveRecord(record).catch(() => {
        // Persistence save failure is non-fatal; record is still tracked in memory.
      });
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Reflection reservation (atomic check-and-reserve)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Atomically reserve a REFLECT call slot.
   *
   * Checks the REFLECT call limit and monthly budget, considering both
   * completed reflect operations and pending reservations. If allowed,
   * creates a pending reservation and returns its ID. Returns null if blocked.
   *
   * With SQLite persistence, this uses BEGIN IMMEDIATE for cross-process
   * atomicity. Without persistence, relies on JS single-threaded event loop.
   */
  async reserveReflect(estimatedCost: number): Promise<string | null> {
    this.ensureInitialized();

    if (this.persistence) {
      // Gather current state for the atomic check inside the SQLite transaction.
      const snapshot = this.getSnapshot();
      const pendingCount = Array.from(this.reflectReservations.values()).filter(
        (r) => r.status === 'pending' || r.status === 'completed',
      ).length;
      const totalReflects = snapshot.reflectCount + pendingCount;
      const budget = this.getBudgetStatus();
      return this.persistence.reserveReflect(
        estimatedCost,
        totalReflects,
        budget.spentUsd,
        {
          reflectCallLimit: this.config.reflectCallLimit,
          monthlyBudgetUsd: this.config.monthlyBudgetUsd,
        }
      );
    }

    // In-memory path: JS single-threaded, check-and-set is atomic.
    const snapshot = this.getSnapshot();
    const pendingCount = Array.from(this.reflectReservations.values()).filter(
      (r) => r.status === 'pending' || r.status === 'completed',
    ).length;
    const totalReflects = snapshot.reflectCount + pendingCount;

    if (totalReflects >= this.config.reflectCallLimit) {
      return null;
    }

    const budget = this.getBudgetStatus();
    const projectedSpent = budget.spentUsd + estimatedCost;
    if (this.config.monthlyBudgetUsd > 0 && projectedSpent > this.config.monthlyBudgetUsd) {
      return null;
    }

    this.reflectReservationCounter += 1;
    const id = `reflect-res-${Date.now()}-${this.reflectReservationCounter}`;
    this.reflectReservations.set(id, { status: 'pending', estimatedCost });
    return id;
  }

  /**
   * Confirm a reservation: mark it completed and record usage.
   * Called after a successful or failed external REFLECT attempt.
   */
  async confirmReflect(
    reservationId: string,
    success: boolean,
    error?: string,
    timeout = false,
  ): Promise<void> {
    this.ensureInitialized();

    const estimatedCost = estimateReflectCost();
    const record: UsageRecord = {
      operation: 'reflect',
      timestamp: new Date().toISOString(),
      tokenCount: undefined,
      estimatedCost,
      success,
      error,
      timeout,
    };
    this.records.push(record);
    if (this.persistence) {
      await this.persistence.confirmReflect(reservationId, success, error, timeout);
      this.persistence.saveRecord(record).catch(() => {
        // Persistence save failure is non-fatal; record is still tracked in memory.
      });
    } else {
      const res = this.reflectReservations.get(reservationId);
      if (res) {
        res.status = 'completed';
      }
    }
  }

  /**
   * Release a reservation without recording usage.
   * Called when the external REFLECT was never attempted (e.g. client
   * disconnected before the call). The reservation slot is freed.
   */
  async releaseReflect(reservationId: string): Promise<void> {
    this.ensureInitialized();

    if (this.persistence) {
      await this.persistence.releaseReflect(reservationId);
    } else {
      const res = this.reflectReservations.get(reservationId);
      if (res && res.status === 'pending') {
        res.status = 'released';
      }
    }
  }

  /**
   * Get the status of a reservation (in-memory only; SQLite returns 'unknown').
   */
  getReservationStatus(reservationId: string): 'pending' | 'completed' | 'released' | 'unknown' {
    if (this.persistence) {
      return 'unknown';
    }
    const res = this.reflectReservations.get(reservationId);
    return res ? res.status : 'unknown';
  }

  getSnapshot(): UsageSnapshot {
    this.ensureInitialized();
    const retainRecords = this.records.filter((r) => r.operation === 'retain');
    const recallRecords = this.records.filter((r) => r.operation === 'recall');
    const reflectRecords = this.records.filter((r) => r.operation === 'reflect');

    const totalEstimatedRetainCost = retainRecords.reduce(
      (sum, r) => sum + r.estimatedCost,
      0
    );
    const totalEstimatedRecallCost = recallRecords.reduce(
      (sum, r) => sum + r.estimatedCost,
      0
    );
    const totalEstimatedReflectCost = reflectRecords.reduce(
      (sum, r) => sum + r.estimatedCost,
      0
    );

    const measuredTokenCount = this.records.reduce(
      (sum, r) => sum + (r.tokenCount ?? 0),
      0
    );
    const estimatedTokenCount = this.records.reduce(
      (sum, r) => (r.tokenCount ? 0 : sum + 100), // rough estimate when unknown
      0
    );

    const lastOp = this.records[this.records.length - 1];
    const errors = this.records.filter((r) => !r.success).length;

    return {
      retainCount: retainRecords.length,
      recallCount: recallRecords.length,
      reflectCount: reflectRecords.length,
      totalEstimatedCost:
        totalEstimatedRetainCost + totalEstimatedRecallCost + totalEstimatedReflectCost,
      totalEstimatedRetainCost,
      totalEstimatedRecallCost,
      totalEstimatedReflectCost,
      lastOperationTimestamp: lastOp?.timestamp,
      errors,
      measuredTokenCount,
      estimatedTokenCount,
    };
  }

  getBudgetStatus(): {
    budgetUsd: number;
    spentUsd: number;
    remainingUsd: number;
    percentUsed: number;
    warningLevel: 'none' | '50%' | '75%' | '90%';
    blocked: boolean;
  } {
    this.ensureInitialized();
    const snapshot = this.getSnapshot();
    const spent = snapshot.totalEstimatedCost;
    const remaining = Math.max(0, this.config.monthlyBudgetUsd - spent);
    const percentUsed = this.config.monthlyBudgetUsd > 0 ? (spent / this.config.monthlyBudgetUsd) * 100 : 0;

    let warningLevel: 'none' | '50%' | '75%' | '90%' = 'none';
    if (percentUsed >= 90) warningLevel = '90%';
    else if (percentUsed >= 75) warningLevel = '75%';
    else if (percentUsed >= 50) warningLevel = '50%';

    return {
      budgetUsd: this.config.monthlyBudgetUsd,
      spentUsd: spent,
      remainingUsd: remaining,
      percentUsed,
      warningLevel,
      blocked: percentUsed >= 100,
    };
  }

  canPerformReflect(): { allowed: boolean; reason?: string } {
    this.ensureInitialized();
    const snapshot = this.getSnapshot();
    if (snapshot.reflectCount >= this.config.reflectCallLimit) {
      return {
        allowed: false,
        reason: `REFLECT call limit reached (${this.config.reflectCallLimit} calls).`,
      };
    }
    const budget = this.getBudgetStatus();
    if (budget.blocked) {
      return {
        allowed: false,
        reason: `Monthly budget exhausted ($${this.config.monthlyBudgetUsd}). REFLECT blocked.`,
      };
    }
    return { allowed: true };
  }

  reset(): void {
    this.records = [];
    if (this.persistence) {
      this.persistence.clearRecords().catch(() => {
        // Persistence clear failure is non-fatal; in-memory records are cleared.
      });
    }
  }
}