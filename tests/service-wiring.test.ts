import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Regression test for the production wiring bug:
 *
 * initializeApp() constructed HindsightMemoryService with a usage persistence
 * adapter but never called hindsightService.init(). The service's internal
 * UsageTracker therefore stayed uninitialized, so every usage call
 * (recordRecall / recordRetain / reserveReflect) threw
 * "UsageTracker not initialized". The analyze route catches recall errors and
 * silently returned an empty historicalInvestigations array, dropping real
 * Hindsight memories. Retain also logged a warning after a successful store.
 *
 * This test exercises the REAL initializeApp() wiring (not a mocked service)
 * with the Hindsight SDK mocked, and asserts that recalled memories flow
 * through POST /api/analyze and that resolve does not log retain warnings.
 */

// Real SQLite via Node's native require (same pattern as sqlite-restart tests).
vi.mock('node:sqlite', () => {
  return require('node:sqlite');
});

// Mock the Hindsight SDK client (no real network calls / credits).
vi.mock('../backend/node_modules/@vectorize-io/hindsight-client/dist/src/index', () => {
  const mockClient = {
    retain: vi.fn().mockResolvedValue({ success: true, items_count: 1 }),
    recall: vi.fn().mockResolvedValue({
      results: [
        {
          id: 'mem-wiring-1',
          text: 'CI incident resolved by resetting the mock gateway state between tests',
          metadata: {
            status: 'verified',
            test: 'test_payment_retry',
            signature: 'sig-wiring',
          },
          context: 'Reset mock state between tests',
          mentioned_at: '2026-11-08T00:00:00Z',
        },
      ],
    }),
    reflect: vi.fn().mockResolvedValue({ text: 'answer', based_on: [] }),
  };
  return {
    HindsightClient: vi.fn(() => mockClient),
    __mockClient: mockClient,
  };
});

import { __mockClient } from '../backend/node_modules/@vectorize-io/hindsight-client/dist/src/index';

// Mock the LLM reasoning step: this test targets the recall/retain wiring,
// not the LLM. Deterministic and fully offline.
vi.mock('../backend/src/reasoning', () => {
  return {
    analyzeFailureDetailed: vi.fn().mockResolvedValue({
      analysis: {
        failureSummary: 'mocked analysis',
        possibleCauses: [],
        relevantHistoricalIncidents: [],
        failedApproaches: [],
        verifiedApproaches: [],
        recommendedSteps: ['mocked step'],
        confidence: 'low',
        uncertaintyExplanation: 'mocked',
        hasRelevantHistory: false,
      },
      diagnostics: {
        provider: 'mock',
        model: 'mock',
        attempts: 1,
        fallbackUsed: false,
        latencyMs: 1,
      },
    }),
    AIAnalysisFormatError: class AIAnalysisFormatError extends Error {},
  };
});

// Temp database path must be set BEFORE config/env.ts is imported.
const dbPath = path.join(
  os.tmpdir(),
  `flaketrail-wiring-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_PATH = dbPath;

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let closeDatabase: () => void;

beforeAll(async () => {
  const indexModule = await import('../backend/src/index');
  const databaseModule = await import('../backend/src/persistence/database');
  closeDatabase = databaseModule.closeDatabase;

  // The REAL production wiring under test.
  await indexModule.initializeApp();

  server = createServer(indexModule.app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(resolve as any));
  try {
    closeDatabase();
  } catch {
    // Ignore double-close.
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const file = dbPath + suffix;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
});

const post = async (path: string, body: unknown) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const validLog = `FAILED payments/service_test.py::test_payment_retry - Error: timeout after 30s waiting for payment gateway mock
  File "payments/mock_gateway.py", line 42, in wait_for_response
    raise TimeoutError("timeout after 30s waiting for payment gateway mock")`;

describe('Service wiring - initializeApp initializes the Hindsight service', () => {
  test('POST /api/analyze returns recalled Hindsight memories (not silently dropped)', async () => {
    const { status, json } = await post('/api/analyze', { logText: validLog });

    expect(status).toBe(200);
    expect(json.incidentId).toBeDefined();

    // The mocked SDK returns one memory. If the service's UsageTracker is not
    // initialized, recordRecall throws and the route returns [] instead.
    expect(__mockClient.recall).toHaveBeenCalled();
    expect(Array.isArray(json.historicalInvestigations)).toBe(true);
    expect(json.historicalInvestigations.length).toBe(1);
    expect(json.historicalInvestigations[0].testName).toBe('test_payment_retry');
    expect(json.historicalInvestigations[0].status).toBe('verified');
  });

  test('usage tracking works after initializeApp (recall does not throw internally)', async () => {
    // If the internal UsageTracker were uninitialized, recallSimilarTracked
    // would throw "UsageTracker not initialized" and the route would swallow
    // it. The reflect permission endpoint exposes the usage snapshot; a
    // successfully recorded recall increments totalEstimatedCost.
    const res = await fetch(`${baseUrl}/api/reflect/permission`);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.usage).toBeDefined();
    // At least one recall was recorded by the analyze test above.
    expect(json.usage.totalEstimatedCost).toBeGreaterThan(0);
  });

  test('POST resolve does not log a retain wiring warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { json: analyzeJson } = await post('/api/analyze', { logText: validLog });
      const incidentId = analyzeJson.incidentId;

      const { status, json } = await post(
        `/api/incidents/${incidentId}/resolve`,
        { status: 'verified', ciResult: 'passed', merged: true, fixDescription: 'test fix' }
      );

      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(__mockClient.retain).toHaveBeenCalled();

      // With correct wiring, retainInvestigation completes without throwing,
      // so the route never logs the "Hindsight retain warning" message that
      // appears when the internal usage tracker throws after a successful
      // store.
      const retainWarnings = warnSpy.mock.calls.filter((call) =>
        String(call[0]).includes('Hindsight retain warning')
      );
      expect(retainWarnings).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
