import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock node:sqlite, delegating to the real implementation via Node's native
// require (which can load built-in modules) so that data truly persists to
// disk and survives close/reopen.
vi.mock('node:sqlite', () => {
  return require('node:sqlite');
});

import { initDatabase, getDatabase, closeDatabase } from '../backend/src/persistence/database';
import { initSchema } from '../backend/src/persistence/schema';
import { IncidentRepository } from '../backend/src/persistence/incidentRepository';
import { SqliteUsagePersistence } from '../backend/src/persistence/usagePersistence';
import { SQLiteRetentionPersistence } from '../backend/src/persistence/retentionPersistence';
import { UsageTracker } from '../backend/src/usage';
import { HindsightMemoryService } from '../backend/src/hindsight/service';

let dbPath: string;

beforeEach(() => {
  // Use a unique temp file for each test so we can close/reopen
  dbPath = path.join(os.tmpdir(), `flaketrail-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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
  // Also clean up WAL/SHM files
  for (const suffix of ['-wal', '-shm']) {
    const walPath = dbPath + suffix;
    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath);
    }
  }
});

describe('SQLite Persistence - Real Database Restart', () => {
  test('incidents survive database close and reopen', () => {
    // --- Session 1: Create database, schema, and incidents ---
    const db1 = initDatabase(dbPath);
    initSchema(db1);

    const repo1 = new IncidentRepository(db1);

    const incidentId = 'inc-test-001';
    repo1.create({
      id: incidentId,
      parsedFailure: {
        testName: 'test_payment_retry',
        errorMessage: 'timeout after 30s',
        failureSignature: 'sig-payment-timeout',
        timestamp: '2026-11-01T00:00:00Z',
        ciJobId: 'ci-123',
        ciBranch: 'main',
      },
      historicalInvestigations: [],
      aiAnalysis: {
        failureSummary: 'Payment gateway timeout',
        possibleCauses: [{ cause: 'Mock gateway unavailable', evidence: [], confidence: 'high' }],
        relevantHistoricalIncidents: [],
        failedApproaches: [],
        verifiedApproaches: [],
        recommendedSteps: ['Check mock gateway config'],
        confidence: 'high',
        uncertaintyExplanation: 'Clear timeout error',
        hasRelevantHistory: false,
      },
      status: 'proposed',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    });

    // Verify incident exists in session 1
    const found1 = repo1.getById(incidentId);
    expect(found1).not.toBeNull();
    expect(found1!.parsedFailure.testName).toBe('test_payment_retry');

    const all1 = repo1.listAll();
    expect(all1.length).toBe(1);

    // Close the database (simulating backend shutdown)
    closeDatabase();

    // --- Session 2: Reopen database and verify data survived ---
    const db2 = initDatabase(dbPath);
    // Schema is idempotent, safe to re-init
    initSchema(db2);

    const repo2 = new IncidentRepository(db2);

    const found2 = repo2.getById(incidentId);
    expect(found2).not.toBeNull();
    expect(found2!.id).toBe(incidentId);
    expect(found2!.parsedFailure.testName).toBe('test_payment_retry');
    expect(found2!.parsedFailure.errorMessage).toBe('timeout after 30s');
    expect(found2!.parsedFailure.failureSignature).toBe('sig-payment-timeout');
    expect(found2!.status).toBe('proposed');

    const all2 = repo2.listAll();
    expect(all2.length).toBe(1);
    expect(all2[0].id).toBe(incidentId);

    closeDatabase();
  });

  test('usage records survive database close and reopen', async () => {
    // --- Session 1 ---
    const db1 = initDatabase(dbPath);
    initSchema(db1);

    const usagePersistence1 = new SqliteUsagePersistence(db1);
    const tracker1 = new UsageTracker(
      { monthlyBudgetUsd: 4.75, reflectCallLimit: 10 },
      usagePersistence1
    );
    // Must call init() to load records from persistence
    // (no-op on first run since table is empty)
    await tracker1.init();

    tracker1.recordRetain(1000, true);
    tracker1.recordRecall(500, true);
    tracker1.recordReflect(undefined, true);

    const snapshot1 = tracker1.getSnapshot();
    expect(snapshot1.retainCount).toBe(1);
    expect(snapshot1.recallCount).toBe(1);
    expect(snapshot1.reflectCount).toBe(1);

    closeDatabase();

    // --- Session 2: Reopen and verify records survived ---
    const db2 = initDatabase(dbPath);
    initSchema(db2);

    const usagePersistence2 = new SqliteUsagePersistence(db2);
    const tracker2 = new UsageTracker(
      { monthlyBudgetUsd: 4.75, reflectCallLimit: 10 },
      usagePersistence2
    );
    // init() loads records from SQLite
    await tracker2.init();

    const snapshot2 = tracker2.getSnapshot();
    expect(snapshot2.retainCount).toBe(1);
    expect(snapshot2.recallCount).toBe(1);
    expect(snapshot2.reflectCount).toBe(1);
    expect(snapshot2.totalEstimatedCost).toBeGreaterThan(0);

    closeDatabase();
  });

  test('retention ledger survives database close and reopen', async () => {
    // --- Session 1 ---
    const db1 = initDatabase(dbPath);
    initSchema(db1);

    const retention1 = new SQLiteRetentionPersistence(db1);

    const dedupeKey = 'inc-test-001:sig-payment-timeout';
    expect(await retention1.isRetentionRecorded(dedupeKey)).toBe(false);

    await retention1.recordRetention(dedupeKey);
    expect(await retention1.isRetentionRecorded(dedupeKey)).toBe(true);

    closeDatabase();

    // --- Session 2: Reopen and verify retention survived ---
    const db2 = initDatabase(dbPath);
    initSchema(db2);

    const retention2 = new SQLiteRetentionPersistence(db2);

    expect(await retention2.isRetentionRecorded(dedupeKey)).toBe(true);

    closeDatabase();
  });

  test('HindsightMemoryService with SQLite persistence survives restart', async () => {
    // --- Session 1 ---
    const db1 = initDatabase(dbPath);
    initSchema(db1);

    const usagePersistence1 = new SqliteUsagePersistence(db1);
    const retentionPersistence1 = new SQLiteRetentionPersistence(db1);

    const service1 = new HindsightMemoryService(
      'test-bank',
      'test-key',
      'https://api.hindsight.vectorize.io',
      retentionPersistence1,
      usagePersistence1
    );
    await service1.init();

    // Record a retention ledger entry directly
    await retentionPersistence1.recordRetention('inc-1:sig-1');
    expect(await retentionPersistence1.isRetentionRecorded('inc-1:sig-1')).toBe(true);

    const usage1 = service1.getUsageSnapshot();
    expect(usage1.retainCount).toBe(0);

    closeDatabase();

    // --- Session 2: Reopen ---
    const db2 = initDatabase(dbPath);
    initSchema(db2);

    const usagePersistence2 = new SqliteUsagePersistence(db2);
    const retentionPersistence2 = new SQLiteRetentionPersistence(db2);

    const service2 = new HindsightMemoryService(
      'test-bank',
      'test-key',
      'https://api.hindsight.vectorize.io',
      retentionPersistence2,
      usagePersistence2
    );
    await service2.init();

    // Retention ledger entry from session 1 should still be there
    expect(await retentionPersistence2.isRetentionRecorded('inc-1:sig-1')).toBe(true);

    closeDatabase();
  });

  test('closeDatabase is idempotent when not initialized', () => {
    // Should not throw if already closed / not initialized
    expect(() => closeDatabase()).not.toThrow();
  });

  test('getDatabase throws if not initialized', () => {
    expect(() => getDatabase()).toThrow(
      'Database not initialized. Call initDatabase() before accessing the database.'
    );
  });
});
