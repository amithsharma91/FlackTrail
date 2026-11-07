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
import { UsageTracker } from '../usage';

const MAX_RECALL_RESULTS = 5;

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
  private retainedSignatures: Set<string>; // duplicate-retention protection

  constructor(bankId: string, apiKey: string, apiUrl: string) {
    if (!bankId || bankId === 'default') {
      throw new Error('HINDSIGHT_BANK_ID must be set and must not be "default"');
    }
    this.bankId = bankId;
    this.client = new HindsightClient({
      baseUrl: apiUrl,
      apiKey,
    });
    this.usageTracker = new UsageTracker();
    this.retainedSignatures = new Set();
  }

  /**
   * RETAIN: Store a confirmed investigation outcome in Hindsight memory.
   * Secrets are redacted before content is sent to Hindsight.
   *
   * Duplicate-retention protection: skips retention if the same
   * incidentId + failureSignature combination was already retained.
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

    // Duplicate-retention protection: skip if same incident+signature already retained
    const dedupeKey = `${incidentId}:${data.failureSignature}`;
    if (this.retainedSignatures.has(dedupeKey)) {
      // Already retained; skip silently to avoid duplicate Cloud charges
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
      const response: RetainResponse = await this.client.retain(
        this.bankId,
        content,
        {
          context: 'The FlakeTrail agent is speaking',
          metadata,
          documentId: data.incidentId,
        }
      );

      if (!response.success) {
        throw new Error(
          `Hindsight retain reported failure: items_count=${response.items_count}`
        );
      }

      // Mark as retained to prevent duplicates
      this.retainedSignatures.add(dedupeKey);

      // Track usage (measured token count not returned by SDK, so estimate)
      this.usageTracker.recordRetain(undefined, true);
    } catch (err: any) {
      this.usageTracker.recordRetain(undefined, false, err.message);
      throw new Error(
        `Hindsight retain failed: ${err.message || String(err)}`
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
      const response: RecallResponse = await this.client.recall(
        this.bankId,
        query,
        {
          budget: 'mid',
          trace: false,
          includeEntities: true,
          maxEntityTokens: 500,
        }
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
      this.usageTracker.recordRecall(undefined, false, err.message);
      throw new Error(
        `Hindsight recall failed: ${err.message || String(err)}`
      );
    }
  }

  /**
   * RECALL wrapper used by the API route that tracks usage regardless of outcome.
   * This is the public entry point used by analyze.ts.
   */
  async recallSimilarTracked(
    failureSignature: string,
    tags?: string[]
  ): Promise<HistoricalInvestigation[]> {
    try {
      const results = await this.recallSimilar(failureSignature, tags);
      this.usageTracker.recordRecall(undefined, true);
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
      const response: ReflectResponse = await this.client.reflect(
        this.bankId,
        query,
        {
          context,
          budget: 'mid',
        }
      );

      this.usageTracker.recordReflect(undefined, true);

      return {
        answer: response.text,
        basedOn: (response.based_on || []).map((fact) => ({
          id: fact.id ?? '',
          text: fact.text,
        })),
      };
    } catch (err: any) {
      this.usageTracker.recordReflect(undefined, false, err.message);
      throw new Error(
        `Hindsight reflect failed: ${err.message || String(err)}`
      );
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
  }
}
