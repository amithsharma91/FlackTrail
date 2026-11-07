import {
  HistoricalInvestigation,
  InvestigationData,
  IncidentStatus,
} from '../shared/index';

export interface HindsightService {
  recallSimilar(
    failureSignature: string,
    tags?: string[]
  ): Promise<HistoricalInvestigation[]>;
  retainInvestigation(
    incidentId: string,
    data: InvestigationData
  ): Promise<void>;
}

export class HindsightMemoryService implements HindsightService {
  private bankId: string;
  private apiKey: string;
  private client: any;

  constructor(bankId: string, apiKey: string) {
    this.bankId = bankId;
    this.apiKey = apiKey;
    this.client = this.initializeClient();
  }

  private initializeClient(): any {
    try {
      // The official Hindsight TypeScript SDK is @vectorize-io/hindsight-client
      // We initialize it lazily; if the package is not installed or the
      // SDK API differs, we surface a clear error at call time.
      const mod = require('@vectorize-io/hindsight-client');
      // The SDK exports a client factory; we attempt common export shapes.
      const createClient =
        mod.createClient || mod.default || mod.HindsightClient;
      if (createClient) {
        return new createClient({
          apiKey: this.apiKey,
          bankId: this.bankId,
        });
      }
      return mod;
    } catch (err) {
      // SDK not installed or incompatible; we will throw at call time.
      return null;
    }
  }

  async recallSimilar(
    failureSignature: string,
    tags?: string[]
  ): Promise<HistoricalInvestigation[]> {
    if (!this.client || typeof this.client.recall !== 'function') {
      throw new Error(
        'Hindsight SDK not initialized. Install @vectorize-io/hindsight-client and configure HINDSIGHT_API_KEY/HINDSIGHT_BANK_ID.'
      );
    }

    try {
      const result = await this.client.recall({
        bank: this.bankId,
        query: failureSignature,
        tags,
      });

      // Normalize SDK response into HistoricalInvestigation[]
      const memories = result.memories || result.results || [];
      return memories.map((m: any) => ({
        id: m.id || m.memory_id || '',
        testName: m.testName || m.entities?.testName || 'unknown',
        errorMessage: m.text || m.content || '',
        failureSignature: m.failureSignature || failureSignature,
        status: m.status || 'proposed',
        attemptedFix: m.attemptedFix || m.text,
        ciJobId: m.ciJobId || m.entities?.ciJobId,
        ciBranch: m.ciBranch || m.entities?.ciBranch,
        prLink: m.prLink || m.entities?.prLink,
        timestamp: m.timestamp || m.createdAt || new Date().toISOString(),
        source: m.id || m.memory_id,
      }));
    } catch (err: any) {
      throw new Error(
        `Hindsight recall failed: ${err.message || String(err)}`
      );
    }
  }

  async retainInvestigation(
    incidentId: string,
    data: InvestigationData
  ): Promise<void> {
    if (!this.client || typeof this.client.retain !== 'function') {
      throw new Error(
        'Hindsight SDK not initialized. Install @vectorize-io/hindsight-client and configure HINDSIGHT_API_KEY/HINDSIGHT_BANK_ID.'
      );
    }

    try {
      const content = [
        `CI incident ${data.incidentId}: ${data.testName}`,
        `Error: ${data.errorMessage}`,
        `Failure signature: ${data.failureSignature}`,
        `Outcome: ${data.outcome}`,
        data.attemptedFix ? `Attempted fix: ${data.attemptedFix}` : '',
        data.ciResult ? `CI result: ${data.ciResult}` : '',
        data.merged ? 'Change merged: yes' : 'Change merged: no',
        data.prLink ? `PR link: ${data.prLink}` : '',
        data.notes ? `Notes: ${data.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      await this.client.retain({
        bank: this.bankId,
        content,
        tags: [
          `status:${data.outcome}`,
          `test:${data.testName}`,
          `signature:${data.failureSignature}`,
        ].filter(Boolean),
        context: 'The FlakeTrail agent is speaking',
      });
    } catch (err: any) {
      throw new Error(
        `Hindsight retain failed: ${err.message || String(err)}`
      );
    }
  }
}
