/**
 * Hindsight usage tracker.
 *
 * Tracks RETAIN, RECALL, and REFLECT operations locally for cost estimation.
 * This is NOT authoritative billing - it is a local estimate only.
 * Actual billing is determined by Hindsight Cloud.
 */

import {
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

export class UsageTracker {
  private records: UsageRecord[] = [];
  private config: UsageTrackerConfig;

  constructor(config: Partial<UsageTrackerConfig> = {}) {
    this.config = {
      monthlyBudgetUsd: DEFAULT_USAGE_CONFIG.monthlyBudgetUsd,
      reflectCallLimit: DEFAULT_USAGE_CONFIG.reflectCallLimit,
      ...config,
    };
  }

  recordRetain(tokenCount?: number, success = true, error?: string): void {
    const estimatedCost = tokenCount
      ? estimateRetainCost(tokenCount)
      : estimateRetainCost(0); // fallback: 0 tokens = $0 estimate
    this.records.push({
      operation: 'retain',
      timestamp: new Date().toISOString(),
      tokenCount,
      estimatedCost,
      success,
      error,
    });
  }

  recordRecall(tokenCount?: number, success = true, error?: string): void {
    const estimatedCost = tokenCount
      ? estimateRecallCost(tokenCount)
      : estimateRecallCost(0);
    this.records.push({
      operation: 'recall',
      timestamp: new Date().toISOString(),
      tokenCount,
      estimatedCost,
      success,
      error,
    });
  }

  recordReflect(tokenCount?: number, success = true, error?: string): void {
    const estimatedCost = estimateReflectCost();
    this.records.push({
      operation: 'reflect',
      timestamp: new Date().toISOString(),
      tokenCount,
      estimatedCost,
      success,
      error,
    });
  }

  getSnapshot(): UsageSnapshot {
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
  }
}
