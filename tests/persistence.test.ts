import { describe, test, expect, beforeEach, vi } from 'vitest';
import { UsageTracker } from '../backend/src/usage';

class MockPersistence implements UsagePersistence {
  records: UsageRecord[] = [];
  shouldFailSave = false;
  shouldFailLoad = false;

  async loadRecords(): Promise<UsageRecord[]> {
    if (this.shouldFailLoad) throw new Error('DB load failed');
    return [...this.records];
  }
  async saveRecord(record: UsageRecord): Promise<void> {
    if (this.shouldFailSave) throw new Error('DB save failed');
    this.records.push(record);
  }
  async clearRecords(): Promise<void> {
    this.records = [];
  }
}

function makeRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    operation: 'retain',
    timestamp: new Date().toISOString(),
    estimatedCost: 0.01,
    success: true,
    ...overrides,
  };
}

describe('Persistence - UsageTracker with persistence adapter', () => {
  let persistence: MockPersistence;

  beforeEach(() => {
    persistence = new MockPersistence();
  });

  test('usage records survive a simulated backend restart (new tracker loads old records)', async () => {
    const tracker1 = new UsageTracker({}, persistence);
    await tracker1.init();
    tracker1.recordRetain(1000, true);
    tracker1.recordRecall(500, true);
    // Wait for the async save to flush.
    await new Promise((r) => setTimeout(r, 50));

    // Simulate restart: construct a new tracker backed by the same persistence.
    const tracker2 = new UsageTracker({}, persistence);
    await tracker2.init();

    const snapshot = tracker2.getSnapshot();
    expect(snapshot.retainCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.recallCount).toBeGreaterThanOrEqual(1);
  });

  test('persistence initialization loads records asynchronously on construction', async () => {
    persistence.records = [makeRecord({ operation: 'reflect' })];
    const tracker = new UsageTracker({}, persistence);
    await tracker.init();
    const snapshot = tracker.getSnapshot();
    expect(snapshot.reflectCount).toBeGreaterThanOrEqual(1);
  });

  test('persistence load failure is non-fatal; tracker starts empty', async () => {
    persistence.shouldFailLoad = true;
    const tracker = new UsageTracker({}, persistence);
    await tracker.init();
    const snapshot = tracker.getSnapshot();
    expect(snapshot.retainCount).toBe(0);
    expect(snapshot.errors).toBe(0);
  });

  test('persistence save failure is non-fatal; record still tracked in memory', async () => {
    persistence.shouldFailSave = true;
    const tracker = new UsageTracker({}, persistence);
    await tracker.init();
    tracker.recordRetain(1000, true);
    const snapshot = tracker.getSnapshot();
    expect(snapshot.retainCount).toBe(1);
    expect(snapshot.totalEstimatedCost).toBeGreaterThan(0);
  });

  test('clearRecords resets persistence and tracker', async () => {
    const tracker = new UsageTracker({}, persistence);
    await tracker.init();
    tracker.recordRetain(1000, true);
    await new Promise((r) => setTimeout(r, 50));
    tracker.reset();
    const snapshot = tracker.getSnapshot();
    expect(snapshot.retainCount).toBe(0);
  });
});
