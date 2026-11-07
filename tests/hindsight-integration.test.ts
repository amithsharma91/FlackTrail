import { describe, test, expect, beforeEach, vi } from 'vitest';
import { HindsightMemoryService } from '../backend/src/hindsight/service';

// Mock the Hindsight SDK module at the exact path the backend service resolves it to
// (backend/node_modules/@vectorize-io/hindsight-client/dist/src/index). This prevents
// any real network calls / credit consumption.
vi.mock('../backend/node_modules/@vectorize-io/hindsight-client/dist/src/index', () => {
  const mockClient = {
    retain: vi.fn().mockResolvedValue({ success: true, items_count: 1 }),
    recall: vi.fn().mockResolvedValue({ results: [] }),
    reflect: vi.fn().mockResolvedValue({ text: 'reflect answer', based_on: [] }),
  };
  return {
    HindsightClient: vi.fn(() => mockClient),
    __mockClient: mockClient,
  };
});

import { __mockClient } from '../backend/node_modules/@vectorize-io/hindsight-client/dist/src/index';

const bankId = 'flaketrail-ci-memory';
const apiUrl = 'https://api.hindsight.vectorize.io';

function makeService() {
  return new HindsightMemoryService(bankId, 'test-key', apiUrl);
}

const investigationData = {
  incidentId: 'inc-1',
  testName: 'test_payment_retry',
  errorMessage: 'timeout after 30s waiting for payment gateway mock',
  failureSignature: 'sig-001',
  outcome: 'verified' as const,
  ciResult: 'passed',
  merged: true,
  attemptedFix: 'Reset mock state between tests',
  prLink: 'https://github.com/example/pr/1',
  timestamp: '2026-11-02T00:00:00Z',
};

describe('Hindsight Service - Integration (SDK mocked, no real credits)', () => {
  beforeEach(() => {
    __mockClient.retain.mockReset().mockResolvedValue({ success: true, items_count: 1 });
    __mockClient.recall.mockReset().mockResolvedValue({ results: [] });
    __mockClient.reflect.mockReset().mockResolvedValue({ text: 'reflect answer', based_on: [] });
  });

  test('RETAIN: stores a confirmed outcome and redacts secrets before the SDK call', async () => {
    const service = makeService();
    const data = { ...investigationData, errorMessage: 'timeout API_KEY=sk-live-secret123' };

    await service.retainInvestigation('inc-1', data);

    expect(__mockClient.retain).toHaveBeenCalledTimes(1);
    const call = __mockClient.retain.mock.calls[0];
    expect(call[0]).toBe(bankId); // bankId
    // The content sent to the SDK must be redacted: no raw secret.
    expect(String(call[1])).not.toContain('sk-live-secret123');
    expect(String(call[1])).toContain('[REDACTED]');
    expect(call[2].documentId).toBe('inc-1');
  });

  test('RETAIN: duplicate retention for the same incident+signature is skipped (no second SDK call)', async () => {
    const service = makeService();
    const data = { ...investigationData };

    await service.retainInvestigation('inc-1', data);
    await service.retainInvestigation('inc-1', data); // duplicate

    expect(__mockClient.retain).toHaveBeenCalledTimes(1); // second call skipped
  });

  test('RETAIN: different incident+signature is retained separately', async () => {
    const service = makeService();
    await service.retainInvestigation('inc-1', { ...investigationData });
    await service.retainInvestigation('inc-2', { ...investigationData, incidentId: 'inc-2' });

    expect(__mockClient.retain).toHaveBeenCalledTimes(2);
  });

  test('RETAIN: rejects unconfirmed outcomes (proposed hypotheses are not retained)', async () => {
    const service = makeService();
    await expect(
      service.retainInvestigation('inc-1', { ...investigationData, outcome: 'proposed' as const })
    ).rejects.toThrow(/Only confirmed outcomes/);
    expect(__mockClient.retain).not.toHaveBeenCalled();
  });

  test('RETAIN: rejects missing required fields before calling the SDK', async () => {
    const service = makeService();
    await expect(service.retainInvestigation('', investigationData)).rejects.toThrow(/incidentId/);
    expect(__mockClient.retain).not.toHaveBeenCalled();
  });

  test('RECALL: retrieves similar investigations and maps them to HistoricalInvestigation[]', async () => {
    __mockClient.recall.mockResolvedValue({
      results: [
        {
          id: 'mem-1',
          text: 'previous timeout fix details',
          metadata: { status: 'verified', test: 'test_payment_retry', signature: 'sig-001' },
          context: 'Reset mock state between tests',
          mentioned_at: '2026-11-02T00:00:00Z',
        },
      ],
    });

    const service = makeService();
    const results = await service.recallSimilar('sig-001');

    expect(__mockClient.recall).toHaveBeenCalledWith(bankId, 'sig-001', expect.any(Object));
    expect(results.length).toBe(1);
    expect(results[0].testName).toBe('test_payment_retry');
    expect(results[0].status).toBe('verified');
    expect(results[0].attemptedFix).toContain('Reset mock state');
  });

  test('RECALL: returns at most five memories (MAX_RECALL_RESULTS cap)', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({
      id: `mem-${i}`,
      text: `memory ${i}`,
      metadata: { status: 'failed', test: 't', signature: 'sig' },
    }));
    __mockClient.recall.mockResolvedValue({ results: ten });

    const service = makeService();
    const results = await service.recallSimilar('sig');

    expect(results.length).toBeLessThanOrEqual(5);
  });

  test('RECALL: connection failure throws a wrapped error', async () => {
    __mockClient.recall.mockRejectedValue(new Error('ECONNREFUSED'));
    const service = makeService();
    await expect(service.recallSimilar('sig')).rejects.toThrow(/Hindsight recall failed/);
  });

  test('REFLECT: is an explicit operation and can be invoked directly', async () => {
    __mockClient.reflect.mockResolvedValue({ text: 'based on memory...', based_on: [{ id: 'mem-1', text: 'fact' }] });
    const service = makeService();
    const result = await service.reflectOnInvestigation('why did this fail?', 'context');

    expect(__mockClient.reflect).toHaveBeenCalledWith(bankId, 'why did this fail?', expect.any(Object));
    expect(result.answer).toBe('based on memory...');
    expect(result.basedOn.length).toBe(1);
  });

  test('REFLECT: rejects empty query before calling the SDK', async () => {
    const service = makeService();
    await expect(service.reflectOnInvestigation('')).rejects.toThrow(/query is required/);
    expect(__mockClient.reflect).not.toHaveBeenCalled();
  });

  test('canPerformReflect: allowed when under budget and call limits', () => {
    const service = makeService();
    const permission = service.canPerformReflect();
    expect(permission.allowed).toBe(true);
  });

  test('getUsageSnapshot: starts at zero for retain, recall, reflect', () => {
    const service = makeService();
    const snapshot = service.getUsageSnapshot();
    expect(snapshot.retainCount).toBe(0);
    expect(snapshot.recallCount).toBe(0);
    expect(snapshot.reflectCount).toBe(0);
  });

  test('resetUsageTracker: clears usage counts and retained signatures', async () => {
    const service = makeService();
    await service.retainInvestigation('inc-1', investigationData);
    service.resetUsageTracker();
    const snapshot = service.getUsageSnapshot();
    expect(snapshot.retainCount).toBe(0);
    // After reset, the same incident+signature can be retained again (dedupe cleared).
    await service.retainInvestigation('inc-1', investigationData);
    expect(__mockClient.retain).toHaveBeenCalledTimes(2);
  });
});
