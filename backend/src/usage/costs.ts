/**
 * Hindsight Cloud cost configuration.
 *
 * Published rates (as observed in the Hindsight dashboard):
 *   RETAIN:   $10.00  / 1,000,000 tokens
 *   RECALL:   $0.75   / 1,000,000 tokens
 *   REFLECT:  $0.05   per call
 *   STORAGE:  $0.25   / 1,000,000 tokens / month
 *
 * These are the rates used for LOCAL ESTIMATION ONLY.
 * Local tracking is an estimate, not authoritative billing.
 * Actual billing is determined by Hindsight Cloud.
 */

export const HINDSIGHT_COSTS = {
  RETAIN_PER_MILLION_TOKENS: 10.00,
  RECALL_PER_MILLION_TOKENS: 0.75,
  REFLECT_PER_CALL: 0.05,
  STORAGE_PER_MILLION_TOKENS_PER_MONTH: 0.25,
} as const;

export const TOKENS_PER_MILLION = 1_000_000;

export function estimateRetainCost(tokenCount: number): number {
  return (tokenCount / TOKENS_PER_MILLION) * HINDSIGHT_COSTS.RETAIN_PER_MILLION_TOKENS;
}

export function estimateRecallCost(tokenCount: number): number {
  return (tokenCount / TOKENS_PER_MILLION) * HINDSIGHT_COSTS.RECALL_PER_MILLION_TOKENS;
}

export function estimateReflectCost(): number {
  return HINDSIGHT_COSTS.REFLECT_PER_CALL;
}

export function estimateStorageCost(tokenCount: number): number {
  return (tokenCount / TOKENS_PER_MILLION) * HINDSIGHT_COSTS.STORAGE_PER_MILLION_TOKENS_PER_MONTH;
}
