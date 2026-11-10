import { describe, test, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import { AddressInfo } from 'net';

// Mock node:sqlite - functional in-memory store
vi.mock('node:sqlite', () => {
  const Database = class {
    private records: Map<string, any> = new Map();

    constructor(filename: string) {}

    exec(sql: string) {}

    prepare(sql: string) {
      const isInsert = sql.includes('INSERT INTO incidents');
      const isSelectById = sql.includes('SELECT * FROM incidents WHERE id = ?');
      const isSelectAll = sql.includes('SELECT * FROM incidents ORDER BY');
      const isSelectDup = sql.includes('SELECT 1 FROM incidents WHERE id = ? AND failure_signature = ?');
      const isUpdate = sql.includes('UPDATE incidents SET');
      const isDelete = sql.includes('DELETE FROM incidents');

      return {
        run: (...params: any[]) => {
          if (isInsert) {
            this.records.set(params[0], {
              id: params[0],
              test_name: params[1],
              error_message: params[2],
              error_type: params[3],
              stack_trace: params[4],
              failure_signature: params[5],
              environment: params[6],
              file_paths: params[7],
              timestamp: params[8],
              ci_job_id: params[9],
              ci_branch: params[10],
              raw_log_excerpt: params[11],
              status: params[12],
              outcome: params[13],
              created_at: params[14],
              updated_at: params[15],
              historical_investigations: null,
              ai_analysis: null,
            });
          } else if (isUpdate) {
            const id = params[params.length - 1];
            const record = this.records.get(id);
            if (record) {
              let idx = 0;
              if (sql.includes('status = ?')) { record.status = params[idx++]; }
              if (sql.includes('outcome = ?')) { record.outcome = params[idx++]; }
              if (sql.includes('updated_at = ?')) { record.updated_at = params[idx++]; }
              this.records.set(id, record);
            }
          } else if (isDelete) {
            this.records.clear();
          }
          return this;
        },
        get: (...params: any[]) => {
          if (isSelectById) {
            return this.records.get(params[0]) || undefined;
          }
          if (isSelectDup) {
            const record = this.records.get(params[0]);
            if (record && record.failure_signature === params[1]) return { '1': 1 };
            return undefined;
          }
          return undefined;
        },
        all: () => {
          if (isSelectAll) {
            return Array.from(this.records.values());
          }
          return [];
        },
        bind: () => this,
      };
    }
    close(): void {}
  };
  return { Database };
});

// Mock the Hindsight service module (relative path resolves correctly)
vi.mock('../backend/src/hindsight/service', () => {
  const mockService = {
    recallSimilarTracked: vi.fn().mockResolvedValue([]),
    retainInvestigation: vi.fn().mockResolvedValue(undefined),
    reflectOnInvestigation: vi.fn().mockResolvedValue({ text: 'reflect answer', based_on: [] }),
    canPerformReflect: vi.fn().mockReturnValue({ allowed: true }),
    getUsageSnapshot: vi.fn().mockReturnValue({
      retainCount: 0, recallCount: 0, reflectCount: 0, totalEstimatedCost: 0,
      totalEstimatedRetainCost: 0, totalEstimatedRecallCost: 0, totalEstimatedReflectCost: 0,
      errors: 0, measuredTokenCount: 0, estimatedTokenCount: 0,
    }),
    getBudgetStatus: vi.fn().mockReturnValue({
      budgetUsd: 4.75, spentUsd: 0, remainingUsd: 4.75, percentUsed: 0,
      warningLevel: 'none', blocked: false,
    }),
    resetUsageTracker: vi.fn(),
  };
  return {
    HindsightMemoryService: vi.fn(() => mockService),
    __mockService: mockService,
  };
});

import { app } from '../backend/src/index';
import { clearAll, initIncidentStore } from '../backend/src/store/incidents';
import { __mockService } from '../backend/src/hindsight/service';
import { config } from '../backend/src/config/env';
import { setHindsightService as setAnalyzeHindsightService } from '../backend/src/routes/analyze';
import { setHindsightService as setIncidentsHindsightService } from '../backend/src/routes/incidents';
import { setAnalysisOrchestrator } from '../backend/src/reasoning';
import { AllProvidersFailedError } from '../backend/src/llm/orchestrator';
import { Database } from 'node:sqlite';

const mockAnalysisOrchestrator = {
  generateWithFallback: vi.fn(),
};

const mockLLMAnalysis = {
  failureSummary: 'The payment gateway mock timed out.',
  possibleCauses: [
    {
      cause: 'Shared mock state is not reset between tests.',
      evidence: ['Timeout waiting for payment gateway mock'],
      confidence: 'high',
    },
  ],
  recommendedSteps: ['Reset the mock state between tests.'],
  confidence: 'high',
  uncertaintyExplanation: 'A verified memory supports this cause.',
};

let server: ReturnType<typeof createServer>;
let baseUrl: string;

beforeAll(async () => {
  // Set Hindsight env vars so getHindsightService() creates a real instance
  process.env.HINDSIGHT_API_KEY = 'test-hindsight-key';
  process.env.HINDSIGHT_BANK_ID = 'test-bank';
  process.env.HINDSIGHT_API_URL = 'https://api.hindsight.vectorize.io';
  // Update config object since it was created at import time
  config.hindsightApiKey = process.env.HINDSIGHT_API_KEY;
  config.hindsightBankId = process.env.HINDSIGHT_BANK_ID;
  config.hindsightApiUrl = process.env.HINDSIGHT_API_URL;

  // Initialize the incident store with a mock database
  const mockDb = new Database(':memory:') as any;
  initIncidentStore(mockDb);

  // Set the mock hindsight service for both analyze.ts and incidents.ts routes
  setAnalyzeHindsightService(__mockService);
  setIncidentsHindsightService(__mockService);

  // Use a deterministic LLM response; provider adapters are covered separately.
  setAnalysisOrchestrator(mockAnalysisOrchestrator);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(resolve as any));
});

beforeEach(() => {
  clearAll();
  mockAnalysisOrchestrator.generateWithFallback.mockReset().mockResolvedValue({
    content: JSON.stringify(mockLLMAnalysis),
    provider: 'openrouter',
    model: 'openrouter/free',
    latencyMs: 5,
    attempts: 1,
    fallbackUsed: false,
    usage: { inputTokens: 50, outputTokens: 25 },
  });
  __mockService.recallSimilarTracked.mockReset().mockResolvedValue([]);
  __mockService.retainInvestigation.mockReset().mockResolvedValue(undefined);
  __mockService.reflectOnInvestigation.mockReset().mockResolvedValue({ text: 'reflect answer', based_on: [] });
  __mockService.canPerformReflect.mockReset().mockReturnValue({ allowed: true });
});

const post = async (path: string, body: unknown) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const get = async (path: string) => {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const validLog = `FAILED payments/service_test.py::test_payment_retry - Error: timeout after 30s waiting for payment gateway mock
  File "payments/mock_gateway.py", line 42, in wait_for_response
    raise TimeoutError("timeout after 30s waiting for payment gateway mock")
API_KEY=sk-live-abcdef1234567890`;

describe('Backend API - POST /api/analyze', () => {
  test('successful analysis: parses log, recalls history, returns incident; RECALL invoked, REFLECT not', async () => {
    __mockService.recallSimilarTracked.mockResolvedValueOnce([
      {
        id: 'mem-1', testName: 'test_payment_retry',
        errorMessage: 'previous timeout', failureSignature: 'sig-x',
        status: 'verified', attemptedFix: 'Reset mock state between tests',
        timestamp: '2026-11-02T00:00:00Z', source: 'mem-1',
      },
    ]);

    const { status, json } = await post('/api/analyze', { logText: validLog });

    expect(status).toBe(200);
    expect(json.incidentId).toBeDefined();
    expect(String(json.incidentId)).toMatch(/^inc-/);
    expect(json.parsedFailure.testName).toBe('test_payment_retry');
    expect(json.parsedFailure.errorMessage).toContain('timeout after 30s');
    expect(json.parsedFailure.failureSignature).toBeDefined();
    // Secrets redacted before any Hindsight/LLM call: not present in parsed output.
    expect(JSON.stringify(json.parsedFailure)).not.toContain('sk-live-abcdef1234567890');
    // Normal analysis invokes RECALL...
    expect(__mockService.recallSimilarTracked).toHaveBeenCalled();
    // ...but never REFLECT (explicit only).
    expect(__mockService.reflectOnInvestigation).not.toHaveBeenCalled();
    expect(json.aiAnalysis).toBeDefined();
    expect(json.aiAnalysis.recommendedSteps.length).toBeGreaterThan(0);
    expect(Array.isArray(json.historicalInvestigations)).toBe(true);
  });

  test('at most five memories are passed to reasoning (safety cap)', async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      id: `mem-${i}`, testName: 'test_payment_retry',
      errorMessage: `historical memory ${i}`, failureSignature: 'sig-x',
      status: 'failed', timestamp: '2026-11-01T00:00:00Z', source: `mem-${i}`,
    }));
    __mockService.recallSimilarTracked.mockResolvedValue(manyResults);

    const { status, json } = await post('/api/analyze', { logText: validLog });
    expect(status).toBe(200);
    expect(json.historicalInvestigations.length).toBeLessThanOrEqual(5);
  });

  test('whitespace-only log text returns 400 (invalid request)', async () => {
    const { status, json } = await post('/api/analyze', { logText: '   ' });
    expect(status).toBe(400);
    expect(json.error).toBeDefined();
  });

  test('missing request body returns a safe error response (no internals leaked)', async () => {
    const res = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const json = await res.json();
    expect(res.status).not.toBe(200);
    expect(json).toHaveProperty('error');
    expect(json).toHaveProperty('status');
    expect(json).toHaveProperty('timestamp');
    expect(json.error).not.toContain('ZodError');
    expect(json.error).not.toContain('at ');
    expect(res.headers.get('content-type')?.includes('application/json')).toBe(true);
  });

  test('hindsight recall failure is not fatal: analysis still succeeds with empty history', async () => {
    __mockService.recallSimilarTracked.mockRejectedValue(new Error('Hindsight connection failed'));

    const { status, json } = await post('/api/analyze', { logText: validLog });
    expect(status).toBe(200);
    expect(json.incidentId).toBeDefined();
    expect(json.historicalInvestigations).toEqual([]);
    expect(json.aiAnalysis).toBeDefined();
    expect(__mockService.recallSimilarTracked).toHaveBeenCalled();
  });

  test('secrets are not leaked in API responses', async () => {
    const secretLog = `FAILED test_leak - Error: boom Authorization: Bearer ghp_abcdef1234567890`;
    const { status, json } = await post('/api/analyze', { logText: secretLog });
    expect(status).toBe(200);
    const payload = JSON.stringify(json);
    expect(payload).not.toContain('ghp_abcdef1234567890');
  });

  test('returns 503 (not rule-based output) when every provider is unavailable', async () => {
    mockAnalysisOrchestrator.generateWithFallback.mockRejectedValueOnce(
      new AllProvidersFailedError([
        {
          provider: 'openrouter',
          kind: 'transport',
          statusCode: 401,
          retryable: false,
          message: 'Unauthorized',
        },
        {
          provider: 'gemini',
          kind: 'transport',
          statusCode: 503,
          retryable: true,
          message: 'Unavailable',
        },
      ])
    );

    const { status, json } = await post('/api/analyze', { logText: validLog });

    expect(status).toBe(401);
    expect(json.aiAnalysis).toBeUndefined();
    expect(json.error).toBe(
      'AI provider authentication failed. Please contact the administrator.'
    );
    expect(json).toHaveProperty('status', 401);
    expect(json).toHaveProperty('timestamp');
  });

  test('returns 502 when every provider returns malformed structured output', async () => {
    mockAnalysisOrchestrator.generateWithFallback.mockRejectedValueOnce(
      new AllProvidersFailedError([
        {
          provider: 'openrouter',
          kind: 'validation',
          retryable: false,
          message: 'malformed JSON',
        },
      ])
    );

    const { status, json } = await post('/api/analyze', { logText: validLog });

    expect(status).toBe(502);
    expect(json.aiAnalysis).toBeUndefined();
    expect(json.error).toBe(
      'AI analysis failed: all providers returned malformed analysis'
    );
  });
});

describe('Backend API - Incident CRUD', () => {
  let incidentId: string;

  beforeEach(async () => {
    const { json } = await post('/api/analyze', { logText: validLog });
    incidentId = json.incidentId;
  });

  test('GET /api/incidents/:id returns the incident detail', async () => {
    const { status, json } = await get(`/api/incidents/${incidentId}`);
    expect(status).toBe(200);
    expect(json.id).toBe(incidentId);
    expect(json.parsedFailure.testName).toBe('test_payment_retry');
    expect(json.status).toBe('proposed');
  });

  test('GET /api/incidents/:id for missing incident returns 404', async () => {
    const { status, json } = await get(`/api/incidents/inc-does-not-exist`);
    expect(status).toBe(404);
    expect(json.error).toBe('Incident not found');
  });

  test('GET /api/incidents lists all incidents', async () => {
    const { status, json } = await get('/api/incidents');
    expect(status).toBe(200);
    expect(Array.isArray(json.incidents)).toBe(true);
    expect(json.incidents.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Backend API - POST /api/incidents/:id/resolve', () => {
  let incidentId: string;

  beforeEach(async () => {
    const { json } = await post('/api/analyze', { logText: validLog });
    incidentId = json.incidentId;
  });

  test('successful outcome submission records status and invokes RETAIN', async () => {
    const { status, json } = await post(`/api/incidents/${incidentId}/resolve`, {
      status: 'verified',
      ciResult: 'passed',
      merged: true,
      fixDescription: 'Reset mock state between tests',
      prLink: 'https://github.com/example/pr/1',
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.status).toBe('verified');
    // RETAIN is invoked for confirmed outcomes.
    expect(__mockService.retainInvestigation).toHaveBeenCalled();
    const retainCall = __mockService.retainInvestigation.mock.calls[0];
    expect(retainCall[0]).toBe(incidentId);
    expect(retainCall[1].outcome).toBe('verified');
    expect(retainCall[1].testName).toBe('test_payment_retry');
  });

  test('verified status requires ciResult=passed AND merged=true (invalid verified status)', async () => {
    const { status } = await post(`/api/incidents/${incidentId}/resolve`, {
      status: 'verified', ciResult: 'failed', merged: true,
    });
    expect(status).toBe(400);

    const { status: s2 } = await post(`/api/incidents/${incidentId}/resolve`, {
      status: 'verified', ciResult: 'passed', merged: false,
    });
    expect(s2).toBe(400);
  });

  test('failed and passed_unmerged outcomes are accepted', async () => {
    const { status: s1 } = await post(`/api/incidents/${incidentId}/resolve`, {
      status: 'failed', ciResult: 'failed', merged: false,
    });
    expect(s1).toBe(200);

    const { status: s2 } = await post(`/api/incidents/${incidentId}/resolve`, {
      status: 'passed_unmerged', ciResult: 'passed', merged: false,
    });
    expect(s2).toBe(200);
  });

  test('resolve on missing incident returns 404', async () => {
    const { status } = await post(`/api/incidents/inc-missing/resolve`, {
      status: 'failed',
    });
    expect(status).toBe(404);
  });

  test('hindsight retain failure does not fail the outcome submission locally', async () => {
    __mockService.retainInvestigation.mockRejectedValue(new Error('retain failed'));

    const { status, json } = await post(`/api/incidents/${incidentId}/resolve`, {
      status: 'failed', ciResult: 'failed',
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.status).toBe('failed');
  });
});