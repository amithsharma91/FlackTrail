import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { HindsightMemoryService } from '../backend/src/hindsight/service';
import { UsageTracker } from '../backend/src/usage';
import { TimeoutError, withTimeout } from '../backend/src/utils/timeout';
import { initDatabase, getDatabase, closeDatabase } from '../backend/src/persistence/database';
import { initSchema } from '../backend/src/persistence/schema';
import { SqliteUsagePersistence } from '../backend/src/persistence/usagePersistence';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock node:sqlite, delegating to the real implementation via Node's native
// require (which can load built-in modules) so that data truly persists to
// disk and survives close/reopen.
vi.mock('node:sqlite', () => {
  return require('node:sqlite');
});

// Mock the Hindsight SDK client so we can control timing
vi.mock('../backend/node_modules/@vectorize-io/hindsight-client/dist/src/index', () => {
  const mockClient = {
    retain: vi.fn(),
    recall: vi.fn(),
    reflect: vi.fn(),
  };
  // Use a real class so `new HindsightClient(...)` is a valid constructible call.
  // vi.fn(() => mockClient) can fail with "is not a constructor" under some
  // Vitest versions when invoked with `new`.
  class MockHindsightClient {
    retain = mockClient.retain;
    recall = mockClient.recall;
    reflect = mockClient.reflect;
  }
  return {
    HindsightClient: MockHindsightClient,
    __mockClient: mockClient,
  };
});

import { __mockClient } from '../backend/node_modules/@vectorize-io/hindsight-client/dist/src/index';

const bankId = 'flaketrail-ci-memory';
const apiUrl = 'https://api.hindsight.vectorize.io';

// Short timeouts for testing (overrides the 10s/8s/12s defaults)
const TEST_TIMEOUTS = { retainMs: 50, recallMs: 50, reflectMs: 50 };

function makeService() {
  return new HindsightMemoryService(bankId, 'test-key', apiUrl, undefined, undefined, TEST_TIMEOUTS);
}

const investigationData = {
  incidentId: 'inc-timeout-1',
  testName: 'test_payment_retry',
  errorMessage: 'timeout after 30s',
  failureSignature: 'sig-timeout-001',
  outcome: 'verified' as const,
  ciResult: 'passed',
  merged: true,
  attemptedFix: 'Reset mock state between tests',
  timestamp: '2026-11-01T00:00:00Z',
};

describe('Timeout Utility', () => {
  test('withTimeout resolves before deadline', async () => {
    const promise = Promise.resolve('done');
    const result = await withTimeout(promise, 1000, { operation: 'test' });
    expect(result).toBe('done');
  });

  test('withTimeout throws TimeoutError when deadline exceeded', async () => {
    const promise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('done'), 500);
    });
    await expect(withTimeout(promise, 50)).rejects.toBeInstanceOf(TimeoutError);
  });

  test('withTimeout TimeoutError has code ETIMEDOUT', async () => {
    const promise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('done'), 500);
    });
    await expect(withTimeout(promise, 50)).rejects.toMatchObject({
      code: 'ETIMEDOUT',
      name: 'TimeoutError',
    });
  });

  test('withTimeout clears timeout handle after promise resolves', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    const promise = Promise.resolve('done');
    await withTimeout(promise, 5000);

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  test('withTimeout preserves original errors', async () => {
    const promise = Promise.reject(new Error('original error'));
    await expect(withTimeout(promise, 1000)).rejects.toThrow('original error');
  });

  test('concurrent independent operations each respect their own deadline', async () => {
    const fast = Promise.resolve('fast');
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve('slow'), 200);
    });

    const [fastResult, slowResult] = await Promise.all([
      withTimeout(fast, 1000),
      withTimeout(slow, 1000),
    ]);

    expect(fastResult).toBe('fast');
    expect(slowResult).toBe('slow');
  });
});

describe('Hindsight Service - Timeout Protection', () => {
  beforeEach(() => {
    // Reset individual mock methods (like existing test suite does)
    // Do NOT use vi.resetAllMocks() as it would reset the HindsightClient constructor mock itself
    __mockClient.retain.mockReset();
    __mockClient.recall.mockReset();
    __mockClient.reflect.mockReset();
  });

  test('retain succeeds before timeout', async () => {
    __mockClient.retain.mockResolvedValue({ success: true, items_count: 1 });

    const service = makeService();
    await service.init();

    await service.retainInvestigation('inc-1', investigationData);

    expect(__mockClient.retain).toHaveBeenCalledTimes(1);
    const snapshot = service.getUsageSnapshot();
    expect(snapshot.retainCount).toBe(1);
    expect(snapshot.errors).toBe(0);
  });

  test('retain times out when SDK is slow', async () => {
    // Resolve after 200ms, but timeout is 50ms
    __mockClient.retain.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ success: true, items_count: 1 }), 200);
        }),
    );

    const service = makeService();
    await service.init();

    await expect(
      service.retainInvestigation('inc-1', investigationData),
    ).rejects.toThrow(/timed out/);

    // Remote outcome is unknown: dedupe cache must NOT be updated
    // A second attempt with the same key should NOT be skipped due to dedupe
    const snapshot = service.getUsageSnapshot();
    expect(snapshot.retainCount).toBe(1);
    expect(snapshot.errors).toBe(1);

    // Verify timed-out record counts toward cost
    expect(snapshot.totalEstimatedCost).toBeGreaterThan(0);
  });

  test('timed-out retain does not update dedupe cache', async () => {
    // First call times out (slow mock)
    __mockClient.retain.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ success: true, items_count: 1 }), 200);
        }),
    );

    const service = makeService();
    await service.init();

    await expect(
      service.retainInvestigation('inc-1', investigationData),
    ).rejects.toThrow();

    // Second attempt with same key should NOT be skipped by dedupe
    // (because we don't know if the first one succeeded)
    __mockClient.retain.mockResolvedValueOnce({ success: true, items_count: 1 });
    await service.retainInvestigation('inc-1', investigationData);

    expect(__mockClient.retain).toHaveBeenCalledTimes(2);
  });

  test('original error propagation for retain', async () => {
    __mockClient.retain.mockRejectedValue(new Error('connection refused'));

    const service = makeService();
    await service.init();

    await expect(
      service.retainInvestigation('inc-1', investigationData),
    ).rejects.toThrow(/Hindsight retain failed/);

    const snapshot = service.getUsageSnapshot();
    expect(snapshot.retainCount).toBe(1);
    expect(snapshot.errors).toBe(1);
  });

  test('recall succeeds before timeout', async () => {
    __mockClient.recall.mockResolvedValue({ results: [] });

    const service = makeService();
    await service.init();

    const results = await service.recallSimilarTracked('sig-001');

    expect(__mockClient.recall).toHaveBeenCalledTimes(1);
    expect(results).toEqual([]);
  });

  test('recall times out when SDK is slow', async () => {
    __mockClient.recall.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ results: [] }), 200);
        }),
    );

    const service = makeService();
    await service.init();

    await expect(service.recallSimilarTracked('sig-001')).rejects.toThrow(
      /timed out/,
    );

    const snapshot = service.getUsageSnapshot();
    expect(snapshot.recallCount).toBe(1);
    expect(snapshot.errors).toBe(1);
  });

  test('reflect succeeds before timeout', async () => {
    __mockClient.reflect.mockResolvedValue({
      text: 'answer',
      based_on: [],
    });

    const service = makeService();
    await service.init();

    const result = await service.reflectOnInvestigation('why?', 'context');

    expect(__mockClient.reflect).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe('answer');
  });

  test('reflect times out when SDK is slow', async () => {
    __mockClient.reflect.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ text: 'answer', based_on: [] }), 200);
        }),
    );

    const service = makeService();
    await service.init();

    await expect(
      service.executeReflect('why?', 'context'),
    ).rejects.toThrow(/timed out/);

    const snapshot = service.getUsageSnapshot();
    expect(snapshot.reflectCount).toBe(1);
    expect(snapshot.errors).toBe(1);
  });

  test('concurrent independent retain and recall operations', async () => {
    __mockClient.retain.mockResolvedValue({ success: true, items_count: 1 });
    __mockClient.recall.mockResolvedValue({ results: [] });

    const service = makeService();
    await service.init();

    const retainPromise = service.retainInvestigation('inc-1', investigationData);
    const recallPromise = service.recallSimilarTracked('sig-001');

    const [retainResult, recallResult] = await Promise.all([
      retainPromise.then(() => 'retain-done'),
      recallPromise.then((r) => r.length),
    ]);

    expect(retainResult).toBe('retain-done');
    expect(recallResult).toBe(0);

    const snapshot = service.getUsageSnapshot();
    expect(snapshot.retainCount).toBe(1);
    expect(snapshot.recallCount).toBe(1);
    expect(snapshot.errors).toBe(0);
  });
});

describe('UsageTracker - Timeout Record Handling', () => {
  test('timed-out retain is recorded with timeout=true', async () => {
    const tracker = new UsageTracker();
    await tracker.init();

    tracker.recordRetain(1000, false, 'Operation timed out after 10000ms (retain)', true);

    const snapshot = tracker.getSnapshot();
    expect(snapshot.retainCount).toBe(1);
    expect(snapshot.errors).toBe(1);
    expect(snapshot.totalEstimatedCost).toBeGreaterThan(0);
  });

  test('budget counts timed-out operations toward spend', async () => {
    const tracker = new UsageTracker({ monthlyBudgetUsd: 0.01, reflectCallLimit: 100 });
    await tracker.init();

    // A timed-out retain still costs tokens (we sent the request)
    tracker.recordRetain(10000000, false, 'timeout', true);

    const budget = tracker.getBudgetStatus();
    expect(budget.percentUsed).toBeGreaterThan(0);
  });

  test('UsageSnapshot errors counts timed-out operations', async () => {
    const tracker = new UsageTracker();
    await tracker.init();

    tracker.recordRetain(1000, true); // success
    tracker.recordRetain(1000, false, 'timeout', true); // timeout
    tracker.recordRetain(1000, false, 'confirmed failure'); // confirmed failure

    const snapshot = tracker.getSnapshot();
    expect(snapshot.errors).toBe(2);
  });
});

describe('Concurrent REFLECT Reservation', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `flaketrail-concur-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  });

  afterEach(async () => {
    try {
      closeDatabase();
    } catch {
      // Ignore if already closed
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    for (const suffix of ['-wal', '-shm']) {
      const walPath = dbPath + suffix;
      if (fs.existsSync(walPath)) {
        fs.unlinkSync(walPath);
      }
    }
  });

  test('1. one available REFLECT slot is granted', async () => {
    const tracker = new UsageTracker({ reflectCallLimit: 1, monthlyBudgetUsd: 100 });
    await tracker.init();

    const id = await tracker.reserveReflect(0.05);
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');

    await tracker.confirmReflect(id, true);
    const snapshot = tracker.getSnapshot();
    expect(snapshot.reflectCount).toBe(1);
  });

  test('2. two simultaneous requests competing for one slot', async () => {
    const tracker = new UsageTracker({ reflectCallLimit: 1, monthlyBudgetUsd: 100 });
    await tracker.init();

    const id1 = await tracker.reserveReflect(0.05);
    expect(id1).toBeTruthy();

    const id2 = await tracker.reserveReflect(0.05);
    expect(id2).toBeNull();

    await tracker.confirmReflect(id1!, true);
    const snapshot = tracker.getSnapshot();
    expect(snapshot.reflectCount).toBe(1);
  });

  test('3. ten concurrent requests with limit of ten all succeed', async () => {
    const tracker = new UsageTracker({ reflectCallLimit: 10, monthlyBudgetUsd: 100 });
    await tracker.init();

    const ids = await Promise.all(
      Array.from({ length: 10 }, () => tracker.reserveReflect(0.05))
    );

    expect(ids.filter(Boolean).length).toBe(10);
    expect(ids.some((id) => id === null)).toBe(false);

    await Promise.all(ids.map((id) => tracker.confirmReflect(id!, true)));
    const snapshot = tracker.getSnapshot();
    expect(snapshot.reflectCount).toBe(10);
  });

  test('4. ten concurrent requests with limit of five: only five succeed', async () => {
    const tracker = new UsageTracker({ reflectCallLimit: 5, monthlyBudgetUsd: 100 });
    await tracker.init();

    const ids = await Promise.all(
      Array.from({ length: 10 }, () => tracker.reserveReflect(0.05))
    );

    const granted = ids.filter(Boolean).length;
    expect(granted).toBe(5);
    expect(ids.some((id) => id === null)).toBe(true);

    await Promise.all(ids.filter(Boolean).map((id) => tracker.confirmReflect(id!, true)));
    const snapshot = tracker.getSnapshot();
    expect(snapshot.reflectCount).toBe(5);
  });

  test('5. monthly budget exhaustion blocks reservation', async () => {
    const tracker = new UsageTracker({ reflectCallLimit: 100, monthlyBudgetUsd: 0.01 });
    await tracker.init();

    // consume almost all budget
    tracker.recordRetain(1000000, true); // ~$10 retain cost
    const budget = tracker.getBudgetStatus();
    expect(budget.percentUsed).toBeGreaterThan(0);

    const id = await tracker.reserveReflect(0.05);
    expect(id).toBeNull();
  });

  test('8. reservation release where safe frees the slot', async () => {
    const tracker = new UsageTracker({ reflectCallLimit: 1, monthlyBudgetUsd: 100 });
    await tracker.init();

    const id = await tracker.reserveReflect(0.05);
    expect(id).toBeTruthy();

    // Release without confirming - slot should be freed
    await tracker.releaseReflect(id);
    expect(tracker.getReservationStatus(id)).toBe('released');

    // Same slot should be available again
    const id2 = await tracker.reserveReflect(0.05);
    expect(id2).toBeTruthy();
    await tracker.confirmReflect(id2, true);
    const snapshot = tracker.getSnapshot();
    expect(snapshot.reflectCount).toBe(1);
  });

  test('9. database persistence and restart preserves reflect count', async () => {
    // Session 1: create reservation, confirm, close
    const db1 = initDatabase(dbPath);
    initSchema(db1);
    const persistence1 = new SqliteUsagePersistence(db1);
    const tracker1 = new UsageTracker(
      { reflectCallLimit: 5, monthlyBudgetUsd: 100 },
      persistence1
    );
    await tracker1.init();

    const id = await tracker1.reserveReflect(0.05);
    expect(id).toBeTruthy();
    await tracker1.confirmReflect(id, true);

    const snapshot1 = tracker1.getSnapshot();
    expect(snapshot1.reflectCount).toBe(1);

    closeDatabase();

    // Session 2: reopen, reflect count should persist
    const db2 = initDatabase(dbPath);
    initSchema(db2);
    const persistence2 = new SqliteUsagePersistence(db2);
    const tracker2 = new UsageTracker(
      { reflectCallLimit: 5, monthlyBudgetUsd: 100 },
      persistence2
    );
    await tracker2.init();

    const snapshot2 = tracker2.getSnapshot();
    expect(snapshot2.reflectCount).toBe(1);

    // One slot should be used, 4 remain
    const id2 = await tracker2.reserveReflect(0.05);
    expect(id2).toBeTruthy();

    closeDatabase();
  });

  test('10. concurrent reservations using shared persistence', async () => {
    const db = initDatabase(dbPath);
    initSchema(db);
    const sharedPersistence = new SqliteUsagePersistence(db);

    // Two trackers sharing the same SQLite persistence
    const tracker1 = new UsageTracker(
      { reflectCallLimit: 1, monthlyBudgetUsd: 100 },
      sharedPersistence
    );
    const tracker2 = new UsageTracker(
      { reflectCallLimit: 1, monthlyBudgetUsd: 100 },
      sharedPersistence
    );
    await tracker1.init();
    await tracker2.init();

    // Both try to reserve simultaneously - only one should succeed
    // because SQLite BEGIN IMMEDIATE ensures atomic check-and-reserve
    const [id1, id2] = await Promise.all([
      tracker1.reserveReflect(0.05),
      tracker2.reserveReflect(0.05),
    ]);

    // Exactly one should succeed
    const granted = [id1, id2].filter(Boolean).length;
    expect(granted).toBe(1);

    // Confirm the granted reservation
    if (id1) await tracker1.confirmReflect(id1, true);
    if (id2) await tracker2.confirmReflect(id2, true);

    const snapshot1 = tracker1.getSnapshot();
    expect(snapshot1.reflectCount).toBe(1);

    closeDatabase();
  });
});
