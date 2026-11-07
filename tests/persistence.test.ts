import { describe, test, expect, beforeEach, vi } from 'vitest';
import { UsageTracker, type UsagePersistence, type UsageRecord } from '../backend/src/usage';
import { incidents } from '../backend/src/store/incidents';

// --- Mock persistence adapter simulating a DB-backed usage store ---
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
    tracker1.recordRetain(1000, true);
    tracker1.recordRecall(500, true);
    // Wait for the async save to flush.
    await new Promise((r) => setTimeout(r, 50));

    // Simulate restart: construct a new tracker backed by the same persistence.
    const tracker2 = new UsageTracker({}, persistence);
    await new Promise((r) => setTimeout(r, 50));

    const snapshot = tracker2.getSnapshot();
    expect(snapshot.retainCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.recallCount).toBeGreaterThanOrEqual(1);
  });

  test('persistence initialization loads records asynchronously on construction', async () => {
    persistence.records = [makeRecord({ operation: 'reflect' })];
    const tracker = new UsageTracker({}, persistence);
    // Immediately after construction, load may not have completed yet.
    await new Promise((r) => setTimeout(r, 50));
    const snapshot = tracker.getSnapshot();
    expect(snapshot.reflectCount).toBeGreaterThanOrEqual(1);
  });

  test('persistence load failure is non-fatal; tracker starts empty', async () => {
    persistence.shouldFailLoad = true;
    const tracker = new UsageTracker({}, persistence);
    await new Promise((r) => setTimeout(r, 50));
    const snapshot = tracker.getSnapshot();
    expect(snapshot.retainCount).toBe(0);
    expect(snapshot.errors).toBe(0);
  });

  test('persistence save failure is non-fatal; record still tracked in memory', async () => {
    persistence.shouldFailSave = true;
    const tracker = new UsageTracker({}, persistence);
    tracker.recordRetain(1000, true);
    const snapshot = tracker.getSnapshot();
    // Record is tracked in memory even though persistence save rejected.
    expect(snapshot.retainCount).toBe(1);
    expect(snapshot.totalEstimatedCost).toBeGreaterThan(0);
  });

  test('clearRecords resets persistence and tracker', async () => {
    const tracker = new UsageTracker({}, persistence);
    tracker.recordRetain(1000, true);
    await new Promise((r) => setTimeout(r, 50));
    tracker.reset();
    const snapshot = tracker.getSnapshot();
    expect(snapshot.retainCount).toBe(0);
  });
});

describe('Persistence - In-memory incident store (MVP)', () => {
  beforeEach(() => {
    incidents.clear();
  });

  test('an incident stored in the incident map is retrievable (in-process persistence)', () => {
    const incident = {
      id: 'inc-persist-1',
      parsedFailure: { testName: 'test_x', errorMessage: 'err', failureSignature: 'sig-x' },
      historicalInvestigations: [],
      aiAnalysis: { confidence: 'low', recommendedSteps: [], failureSummary: '', possibleCauses: [], relevantHistoricalIncidents: [], failedApproaches: [], verifiedApproaches: [], uncertaintyExplanation: '', hasRelevantHistory: false },
      status: 'proposed' as const,
      createdAt: new Date().toISOString(),
    };
    incidents.set(incident.id, incident as any);
    const stored = incidents.get('inc-persist-1');
    expect(stored).toBeDefined();
    expect(stored!.parsedFailure.testName).toBe('test_x');
  });

  test('incident status update persists in the store', () => {
    const incident: any = {
      id: 'inc-status-1',
      parsedFailure: { testName: 'test_y', errorMessage: 'err', failureSignature: 'sig-y' },
      historicalInvestigations: [],
      aiAnalysis: { confidence: 'low', recommendedSteps: [], failureSummary: '', possibleCauses: [], relevantHistoricalIncidents: [], failedApproaches: [], verifiedApproaches: [], uncertaintyExplanation: '', hasRelevantHistory: false },
      status: 'proposed',
      createdAt: new Date().toISOString(),
    };
    incidents.set(incident.id, incident);
    incident.status = 'verified';
    incidents.set(incident.id, incident);
    expect(incidents.get('inc-status-1')!.status).toBe('verified');
  });

  test('duplicate incident IDs overwrite rather than duplicate', () => {
    const base: any = { id: 'inc-dup-1', parsedFailure: { testName: 't', errorMessage: 'e', failureSignature: 's' }, historicalInvestigations: [], aiAnalysis: { confidence: 'low', recommendedSteps: [], failureSummary: '', possibleCauses: [], relevantHistoricalIncidents: [], failedApproaches: [], verifiedApproaches: [], uncertaintyExplanation: '', hasRelevantHistory: false }, status: 'proposed', createdAt: new Date().toISOString() };
    incidents.set(base.id, base);
    incidents.set(base.id, { ...base, status: 'failed' });
    expect(incidents.size).toBe(1);
    expect(incidents.get('inc-dup-1')!.status).toBe('failed');
  });
});
