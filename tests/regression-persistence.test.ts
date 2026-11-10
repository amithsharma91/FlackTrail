import { describe, test, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import { AddressInfo } from 'net';

// Use the REAL SQLite implementation so that ai_analysis and
// historical_investigations columns are genuinely persisted and readable back.
// This regression-tests the fix that added these columns to the incidents table
// and to IncidentRepository.create()/rowToIncident(). The `require` delegation
// loads the genuine Node built-in (node:sqlite) at runtime, matching the pattern
// already used by tests/sqlite-restart.test.ts.
vi.mock('node:sqlite', () => {
  return require('node:sqlite');
});

// Mock the Hindsight service module so no real credentials / network calls are needed.
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
import { initSchema } from '../backend/src/persistence/schema';
import { __mockService } from '../backend/src/hindsight/service';
import { config } from '../backend/src/config/env';
import { setHindsightService as setAnalyzeHindsightService } from '../backend/src/routes/analyze';
import { setHindsightService as setIncidentsHindsightService } from '../backend/src/routes/incidents';
import { setAnalysisOrchestrator } from '../backend/src/reasoning';
import { initDatabase, closeDatabase } from '../backend/src/persistence/database';
import type { HistoricalInvestigation, AIAnalysis } from '../backend/src/shared/index';

const mockAnalysisOrchestrator = {
  generateWithFallback: vi.fn(),
};

const mockLLMAnalysis: AIAnalysis = {
  failureSummary: 'The payment gateway mock timed out.',
  possibleCauses: [
    {
      cause: 'Shared mock state is not reset between tests.',
      evidence: ['Timeout waiting for payment gateway mock'],
      confidence: 'high',
    },
  ],
  relevantHistoricalIncidents: [],
  failedApproaches: [],
  verifiedApproaches: [],
  recommendedSteps: ['Reset the mock state between tests.'],
  confidence: 'high',
  uncertaintyExplanation: 'A verified memory supports this cause.',
  hasRelevantHistory: false,
};

const mockHistoricalInvestigations: HistoricalInvestigation[] = [
  {
    id: 'mem-1', testName: 'test_payment_retry',
    errorMessage: 'previous timeout', failureSignature: 'sig-x',
    status: 'verified', attemptedFix: 'Reset mock state between tests',
    timestamp: '2026-11-02T00:00:00Z', source: 'mem-1',
  },
];

let server: ReturnType<typeof createServer>;
let baseUrl: string;

beforeAll(async () => {
  // Deterministic env so dotenv / config does not require real credentials.
  process.env.HINDSIGHT_API_KEY = 'test-hindsight-key';
  process.env.HINDSIGHT_BANK_ID = 'test-bank';
  process.env.HINDSIGHT_API_URL = 'https://api.hindsight.vectorize.io';
  // Update the config object since it was created at import time.
  config.hindsightApiKey = process.env.HINDSIGHT_API_KEY;
  config.hindsightBankId = process.env.HINDSIGHT_BANK_ID;
  config.hindsightApiUrl = process.env.HINDSIGHT_API_URL;

  // REAL in-memory SQLite database with the (fixed) schema that includes
  // ai_analysis and historical_investigations columns.
  process.env.DATABASE_PATH = ':memory:';
  const db = initDatabase();
  initSchema(db);
  initIncidentStore(db);

  setAnalyzeHindsightService(__mockService);
  setIncidentsHindsightService(__mockService);

  // Deterministic LLM response; provider adapters are covered elsewhere.
  setAnalysisOrchestrator(mockAnalysisOrchestrator);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(resolve as any));
  try {
    closeDatabase();
  } catch {
    // Ignore if already closed
  }
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

describe('Backend Regression - aiAnalysis / historicalInvestigations persistence (real SQLite)', () => {
  test('POST /api/analyze stores aiAnalysis and historicalInvestigations in the incident', async () => {
    __mockService.recallSimilarTracked.mockResolvedValueOnce(mockHistoricalInvestigations);

    const { status, json } = await post('/api/analyze', { logText: validLog });

    expect(status).toBe(200);
    expect(json.incidentId).toBeDefined();
    expect(String(json.incidentId)).toMatch(/^inc-/);
    // The immediate response carries the analysis + history (enriched by
    // analyzeFailureDetailed, so assert the LLM-originated fields directly).
    expect(json.aiAnalysis).toBeDefined();
    expect(json.aiAnalysis.failureSummary).toBe(mockLLMAnalysis.failureSummary);
    expect(json.aiAnalysis.recommendedSteps).toEqual(mockLLMAnalysis.recommendedSteps);
    expect(Array.isArray(json.historicalInvestigations)).toBe(true);
    expect(json.historicalInvestigations).toEqual(mockHistoricalInvestigations);

    // Verify the data was actually persisted and can be read back from SQLite.
    const { status: getStatus, json: stored } = await get(`/api/incidents/${json.incidentId}`);
    expect(getStatus).toBe(200);
    expect(stored.id).toBe(json.incidentId);
    expect(stored.parsedFailure.testName).toBe('test_payment_retry');
    expect(stored.parsedFailure.errorMessage).toContain('timeout after 30s');
    // aiAnalysis must be present and non-empty (not null / {}).
    expect(stored.aiAnalysis).toBeDefined();
    expect(stored.aiAnalysis.failureSummary).toBe(mockLLMAnalysis.failureSummary);
    expect(stored.aiAnalysis.recommendedSteps.length).toBeGreaterThan(0);
    // historicalInvestigations must be present and non-empty.
    expect(Array.isArray(stored.historicalInvestigations)).toBe(true);
    expect(stored.historicalInvestigations.length).toBeGreaterThan(0);
    expect(stored.historicalInvestigations[0].testName).toBe('test_payment_retry');
    // Secrets must not leak into the stored incident.
    expect(JSON.stringify(stored)).not.toContain('sk-live-abcdef1234567890');
  });

  test('GET /api/incidents/:id returns the complete incident with aiAnalysis and historicalInvestigations (not empty)', async () => {
    __mockService.recallSimilarTracked.mockResolvedValueOnce(mockHistoricalInvestigations);

    const { json: created } = await post('/api/analyze', { logText: validLog });
    const incidentId = created.incidentId;

    const { status, json } = await get(`/api/incidents/${incidentId}`);
    expect(status).toBe(200);
    expect(json.id).toBe(incidentId);
    expect(json.status).toBe('proposed');

    // Complete incident: aiAnalysis and historicalInvestigations are present and non-empty.
    expect(json.aiAnalysis).toBeDefined();
    expect(Object.keys(json.aiAnalysis).length).toBeGreaterThan(0);
    expect(json.aiAnalysis.recommendedSteps.length).toBeGreaterThan(0);
    expect(Array.isArray(json.historicalInvestigations)).toBe(true);
    expect(json.historicalInvestigations.length).toBeGreaterThan(0);
    expect(json.historicalInvestigations[0].id).toBe('mem-1');
  });

  test('GET /api/incidents/:id for missing incident returns 404', async () => {
    const { status, json } = await get('/api/incidents/inc-does-not-exist');
    expect(status).toBe(404);
    expect(json.error).toBe('Incident not found');
  });

  test('GET /api/incidents list returns incidents with correct data', async () => {
    __mockService.recallSimilarTracked.mockResolvedValueOnce(mockHistoricalInvestigations);

    const { json: created } = await post('/api/analyze', { logText: validLog });

    const { status, json } = await get('/api/incidents');
    expect(status).toBe(200);
    expect(Array.isArray(json.incidents)).toBe(true);
    expect(json.incidents.length).toBeGreaterThanOrEqual(1);

    const incident = json.incidents.find((i: any) => i.id === created.incidentId);
    expect(incident).toBeDefined();
    expect(incident.testName).toBe('test_payment_retry');
    expect(incident.errorMessage).toContain('timeout after 30s');
    expect(incident.failureSignature).toBeDefined();
    expect(incident.status).toBe('proposed');
    expect(incident.ciJobId).toBeUndefined();
    // ciBranch must not leak "timeout" from the error message (parser regression).
    expect(incident.ciBranch).not.toBe('timeout');
  });
});
