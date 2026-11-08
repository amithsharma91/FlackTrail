import {
  HindsightClient,
  RecallResponse,
  ReflectResponse,
  RetainResponse,
} from '@vectorize-io/hindsight-client';
import {
  HistoricalInvestigation,
  InvestigationData,
  IncidentStatus,
  UsageSnapshot,
  BudgetStatus,
  ReflectPermission,
} from '../shared/index';
import { redactSecrets } from '../parser';
import { UsageTracker, UsagePersistence, estimateReflectCost } from '../usage';
import { config } from '../config/env';
import { TimeoutError, withTimeout } from '../utils/timeout';

const MAX_RECALL_RESULTS = 5;

// Application-level timeouts for Hindsight SDK operations.
// The SDK (v0.1.16) does not expose AbortSignal or configurable request timeouts,
// so these deadlines are enforced at the application layer using Promise.race().
const RETAIN_TIMEOUT_MS = 10_000; // 10 seconds
const RECALL_TIMEOUT_MS = 8_000; // 8 seconds
const REFLECT_TIMEOUT_MS = 12_000; // 12 seconds

/**
 * Persistence adapter for the retention ledger. Implementations (e.g. SQLite via
 * Subagent 3's persistence layer) must provide isRetentionRecorded /
 * recordRetention so that duplicate-retention protection survives backend
 * restarts. This is the contract Subagent 3's SQLite layer should implement.
 */
export interface HindsightPersistence {
  /** Returns true if a retention ledger entry already exists for the given key. */
  isRetentionRecorded(key: string): Promise<boolean>;
  /** Marks the given key as retained in the persistent ledger. */
  recordRetention(key: string): Promise<void>;
  /** Clears the entire retention ledger. */
  clearRetentionLedger(): Promise<void>;
}

export interface HindsightService {
  recallSimilar(
    failureSignature: string,
    tags?: string[]
  ): Promise<HistoricalInvestigation[]>;
  retainInvestigation(
    incidentId: string,
    data: InvestigationData
  ): Promise<void>;
  reflectOnInvestigation(
    query: string,
    context?: string
  ): Promise<{ answer: string; basedOn: Array<{ id?: string; text: string }> }>;
  getUsageSnapshot(): UsageSnapshot;
  getBudgetStatus(): BudgetStatus;
  canPerformReflect(): ReflectPermission;
}

export class HindsightMemoryService implements HindsightService {
  private bankId: string;
  private client: HindsightClient;
  private usageTracker: UsageTracker;
  private retainedSignatures: Set<string>; // duplicate-retention protection (in-memory cache)
  private persistence?: HindsightPersistence;
  private retainTimeoutMs: number;
  private recallTimeoutMs: number;
  private reflectTimeoutMs: number;

  constructor(
    bankId: string,
    apiKey: string,
    apiUrl: string,
    persistence?: HindsightPersistence,
    usagePersistence?: UsagePersistence,
    timeouts?: { retainMs?: number; recallMs?: number; reflectMs?: number },
  ) {
    if (!bankId || bankId === 'default') {
      throw new Error('HINDSIGHT_BANK_ID must be set and must not be "default"');
    }
    this.bankId = bankId;
    this.client = new HindsightClient({
      baseUrl: apiUrl,
      apiKey,
    });
    this.usageTracker = new UsageTracker(
      {
        monthlyBudgetUsd: config.hindsightMonthlyBudgetUsd,
        reflectCallLimit: config.hindsightReflectCallLimit,
      },
      usagePersistence
    );
    this.persistence = persistence;
    this.retainedSignatures = new Set();
    this.retainTimeoutMs = timeouts?.retainMs ?? RETAIN_TIMEOUT_MS;
    this.recallTimeoutMs = timeouts?.recallMs ?? RECALL_TIMEOUT_MS;
    this.reflectTimeoutMs = timeouts?.reflectMs ?? REFLECT_TIMEOUT_MS;
  }

  async init(): Promise<void> {
    await this.usageTracker.init();
  }

  /**
   * RETAIN: Store a confirmed investigation outcome in Hindsight memory.
   * Secrets are redacted before content is sent to Hindsight.
   *
   * Duplicate-retention protection: skips retention if the same
   * incidentId + failureSignature combination was already retained, checking
   * both the in-memory cache and the persistent retention ledger.
   *
   * Errors from the SDK are never swallowed — they are recorded and re-thrown.
   */
  async retainInvestigation(
    incidentId: string,
    data: InvestigationData
  ): Promise<void> {
    // Validate input
    if (!incidentId) {
      throw new Error('incidentId is required');
    }
    if (!data.testName) {
      throw new Error('testName is required');
    }
    if (!data.errorMessage) {
      throw new Error('errorMessage is required');
    }
    if (!data.failureSignature) {
      throw new Error('failureSignature is required');
    }
    if (!data.outcome) {
      throw new Error('outcome is required');
    }

    // Only store confirmed outcomes (failed, passed_unmerged, verified)
    // proposed hypotheses are NOT retained as completed investigations
    const validOutcomes: IncidentStatus[] = [
      'failed',
      'passed_unmerged',
      'verified',
    ];
    if (!validOutcomes.includes(data.outcome)) {
      throw new Error(
        `Only confirmed outcomes can be retained. Got: ${data.outcome}`
      );
    }

    // Duplicate-retention protection: skip if same incident+signature already retained.
    // Check in-memory cache first (fast), then persistent ledger.
    const dedupeKey = `${incidentId}:${data.failureSignature}`;
    if (this.retainedSignatures.has(dedupeKey)) {
      // Already retained; skip silently to avoid duplicate Cloud charges
      return;
    }
    if (this.persistence && (await this.persistence.isRetentionRecorded(dedupeKey))) {
      // Persisted from a previous session; sync into in-memory cache and skip
      this.retainedSignatures.add(dedupeKey);
      return;
    }

    // Build content - only investigation outcome, never raw uploaded logs
    const contentLines = [
      `CI incident ${data.incidentId}: ${data.testName}`,
      `Error: ${data.errorMessage}`,
      `Failure signature: ${data.failureSignature}`,
      `Outcome: ${data.outcome}`,
    ];

    if (data.attemptedFix) {
      contentLines.push(`Attempted fix: ${data.attemptedFix}`);
    }
    if (data.ciResult) {
      contentLines.push(`CI result: ${data.ciResult}`);
    }
    if (data.merged !== undefined) {
      contentLines.push(`Change merged: ${data.merged}`);
    }
    if (data.prLink) {
      contentLines.push(`PR link: ${data.prLink}`);
    }
    if (data.notes) {
      contentLines.push(`Notes: ${data.notes}`);
    }
    if (data.timestamp) {
      contentLines.push(`Timestamp: ${data.timestamp}`);
    }

    const rawContent = contentLines.filter(Boolean).join('\n');

    // Redact secrets before sending to Hindsight
    const content = redactSecrets(rawContent);

    // Estimate token count for cost tracking (rough estimate: ~4 chars per token)
    const estimatedTokenCount = Math.ceil(content.length / 4);

    // Build metadata with tags for filtering
    const metadata: Record<string, string> = {
      status: data.outcome,
      test: data.testName,
      signature: data.failureSignature,
      incident_id: data.incidentId,
    };

    try {
      const response: RetainResponse = await withTimeout(
        this.client.retain(
          this.bankId,
          content,
          {
            context: 'The FlakeTrail agent is speaking',
            metadata,
            documentId: data.incidentId,
          },
        ),
        this.retainTimeoutMs,
        { operation: 'retain' },
      );

      if (!response.success) {
        throw new Error(
          `Hindsight retain reported failure: items_count=${response.items_count}`,
        );
      }

      // Mark as retained to prevent duplicates — in-memory cache AND persistent ledger
      this.retainedSignatures.add(dedupeKey);
      if (this.persistence) {
        await this.persistence.recordRetention(dedupeKey);
      }

      // Track usage with estimated token count (SDK does not return measured tokens)
      this.usageTracker.recordRetain(estimatedTokenCount, true);
    } catch (err: any) {
      // Timeout: remote outcome is unknown. Do NOT mark as retained in the
      // dedupe cache or persistent ledger, since the server may have completed
      // the write after we stopped waiting. Record as a timed-out attempt so
      // it is accounted for in usage but not treated as a confirmed failure.
      if (err instanceof TimeoutError) {
        this.usageTracker.recordRetain(
          estimatedTokenCount,
          false,
          err.message,
          true,
        );
        throw new Error(
          `Hindsight retain timed out: ${err.message}. Remote outcome unknown.`,
        );
      }

      // Confirmed failure — record and propagate.
      this.usageTracker.recordRetain(estimatedTokenCount, false, err.message);
      throw new Error(
        `Hindsight retain failed: ${err.message || String(err)}`,
      );
    }
  }

  /**
   * RECALL: Retrieve similar previous investigations from Hindsight memory.
   * Limited to MAX_RECALL_RESULTS (5) to control token usage and cost.
   */
  async recallSimilar(
    failureSignature: string,
    tags?: string[]
  ): Promise<HistoricalInvestigation[]> {
    if (!failureSignature) {
      throw new Error('failureSignature is required');
    }

    // Build query from failure signature
    const query = failureSignature;

    try {
      const response: RecallResponse = await withTimeout(
        this.client.recall(
          this.bankId,
          query,
          {
            budget: 'mid',
            trace: false,
            includeEntities: true,
            maxEntityTokens: 500,
          },
        ),
        this.recallTimeoutMs,
        { operation: 'recall' },
      );

      const results = response.results || [];

      // Limit to MAX_RECALL_RESULTS to control cost and token usage
      const limitedResults = results.slice(0, MAX_RECALL_RESULTS);

      return limitedResults.map((m) => {
        // Extract status from metadata if available
        const status: IncidentStatus =
          m.metadata?.status === 'verified' ||
          m.metadata?.status === 'failed' ||
          m.metadata?.status === 'passed_unmerged'
            ? m.metadata.status
            : 'proposed';

        return {
          id: m.id ?? '',
          testName: m.metadata?.test || 'unknown',
          errorMessage: m.text,
          failureSignature: m.metadata?.signature || failureSignature,
          status,
          attemptedFix: m.context || undefined,
          ciJobId: undefined,
          ciBranch: undefined,
          prLink: undefined,
          timestamp: m.mentioned_at || m.occurred_start || new Date().toISOString(),
          source: m.id ?? '',
        };
      });
    } catch (err: any) {
      // Timeout: record as timed-out attempt.
      if (err instanceof TimeoutError) {
        this.usageTracker.recordRecall(undefined, false, err.message, true);
        throw new Error(
          `Hindsight recall timed out: ${err.message}. Remote outcome unknown.`,
        );
      }

      this.usageTracker.recordRecall(undefined, false, err.message);
      throw new Error(
        `Hindsight recall failed: ${err.message || String(err)}`
      );
    }
  }

  /**
   * RECALL wrapper used by the API route that tracks usage regardless of outcome.
   * This is the public entry point used by analyze.ts.
   *
   * Normal analysis performs ONE RECALL with max 5 memories and NO REFLECT.
   */
  async recallSimilarTracked(
    failureSignature: string,
    tags?: string[]
  ): Promise<HistoricalInvestigation[]> {
    try {
      const results = await this.recallSimilar(failureSignature, tags);
      // Estimate tokens for the recall query (~4 chars per token).
      // The SDK does not return measured token counts for recall.
      const estimatedTokenCount = Math.ceil(failureSignature.length / 4);
      this.usageTracker.recordRecall(estimatedTokenCount, true);
      return results;
    } catch (err: any) {
      throw err;
    }
  }

  /**
   * REFLECT: Reason over stored investigation memories to answer a question.
   * 
   * This is an EXPLICIT, optional operation. It is NOT called during normal
   * analysis. Callers must check canPerformReflect() before invoking.
   */
  async reflectOnInvestigation(
    query: string,
    context?: string
  ): Promise<{ answer: string; basedOn: Array<{ id?: string; text: string }> }> {
    if (!query) {
      throw new Error('query is required');
    }

    try {
      const response: ReflectResponse = await withTimeout(
        this.client.reflect(
          this.bankId,
          query,
          {
            context,
            budget: 'mid',
          },
        ),
        this.reflectTimeoutMs,
        { operation: 'reflect' },
      );

      return {
        answer: response.text,
        basedOn: (response.based_on || []).map((fact) => ({
          id: fact.id ?? '',
          text: fact.text,
        })),
      };
    } catch (err: any) {
      // Timeout: remote outcome unknown. Record as timed-out attempt.
      if (err instanceof TimeoutError) {
        throw new Error(
          `Hindsight reflect timed out: ${err.message}. Remote outcome unknown.`,
        );
      }

      throw new Error(
        `Hindsight reflect failed: ${err.message || String(err)}`
      );
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Reflection reservation delegation (atomic check-and-reserve)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Atomically reserve a REFLECT call slot.
   * Delegates to UsageTracker (which uses SQLite BEGIN IMMEDIATE when persistent).
   * Returns a reservation ID if allowed, null if blocked.
   */
  reserveReflect(): Promise<string | null> {
    return this.usageTracker.reserveReflect(estimateReflectCost());
  }

  /**
   * Confirm a reservation: mark it completed and record usage.
   * Called after a successful or failed external REFLECT attempt.
   */
  confirmReflect(
    reservationId: string,
    success: boolean,
    error?: string,
    timeout = false,
  ): Promise<void> {
    return this.usageTracker.confirmReflect(
      reservationId,
      success,
      error,
      timeout,
    );
  }

  /**
   * Release a reservation without recording usage.
   * Called when the external REFLECT was never attempted.
   */
  releaseReflect(reservationId: string): Promise<void> {
    return this.usageTracker.releaseReflect(reservationId);
  }

  /**
   * Execute a REFLECT with atomic reservation.
   *
   * This is the preferred entry point for REFLECT calls. It atomically
   * reserves a call slot, invokes the external API, then confirms or
   * releases the reservation based on the outcome.
   *
   * This prevents the check-then-act race condition where concurrent
   * requests could both pass canPerformReflect() before either records
   * usage.
   */
  async executeReflect(
    query: string,
    context?: string,
  ): Promise<{ answer: string; basedOn: Array<{ id?: string; text: string }> }> {
    if (!query) {
      throw new Error('query is required');
    }

    const reservationId = await this.reserveReflect();
    if (!reservationId) {
      throw new Error('REFLECT blocked: call limit or budget exceeded');
    }

    try {
      const result = await this.reflectOnInvestigation(query, context);
      await this.confirmReflect(reservationId, true);
      return result;
    } catch (err: any) {
      // Determine if it was a timeout for usage accounting.
      const isTimeout = err.message.includes('timed out');
      await this.confirmReflect(reservationId, false, err.message, isTimeout);
      throw err;
    }
  }

  getUsageSnapshot(): UsageSnapshot {
    return this.usageTracker.getSnapshot();
  }

  getBudgetStatus(): BudgetStatus {
    return this.usageTracker.getBudgetStatus();
  }

  canPerformReflect(): ReflectPermission {
    return this.usageTracker.canPerformReflect();
  }

  resetUsageTracker(): void {
    this.usageTracker.reset();
    this.retainedSignatures.clear();
    if (this.persistence) {
      this.persistence.clearRetentionLedger().catch(() => {
        // Persistence clear failure is non-fatal.
      });
    }
  }

  /**
   * Clear the in-memory duplicate-retention cache and, if configured, the
   * persistent retention ledger. This is a separate concern from usage reset.
   */
  clearRetentionLedger(): void {
    this.retainedSignatures.clear();
    if (this.persistence) {
      this.persistence.clearRetentionLedger().catch(() => {
        // Persistence clear failure is non-fatal; in-memory cache is cleared.
      });
    }
  }
}
