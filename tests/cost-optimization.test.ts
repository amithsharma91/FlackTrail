import { describe, test, expect } from 'vitest';
import { UsageTracker } from '../backend/src/usage';
import { HindsightMemoryService } from '../backend/src/hindsight/service';
import { validateOutcomeStatus } from '../backend/src/shared';
import { redactSecrets } from '../backend/src/parser';

describe('Usage Tracker', () => {
  test('records retain, recall, and reflect operations', async () => {
    const tracker = new UsageTracker();
    await tracker.init();

    tracker.recordRetain(1000, true);
    tracker.recordRecall(500, true);
    tracker.recordReflect(undefined, true);

    const snapshot = tracker.getSnapshot();
    expect(snapshot.retainCount).toBe(1);
    expect(snapshot.recallCount).toBe(1);
    expect(snapshot.reflectCount).toBe(1);
    expect(snapshot.totalEstimatedCost).toBeGreaterThan(0);
  });

  test('budget status warns at 50%, 75%, 90%', async () => {
    const tracker = new UsageTracker({ monthlyBudgetUsd: 10.0 });
    await tracker.init();

    tracker.recordRetain(666666, true);
    const budget = tracker.getBudgetStatus();
    expect(budget.warningLevel).toBe('50%');
    expect(budget.percentUsed).toBeGreaterThanOrEqual(50);
  });

  test('blocks reflect when call limit reached', async () => {
    const tracker = new UsageTracker({ reflectCallLimit: 2 });
    await tracker.init();

    tracker.recordReflect(undefined, true);
    tracker.recordReflect(undefined, true);

    const permission = tracker.canPerformReflect();
    expect(permission.allowed).toBe(false);
    expect(permission.reason).toContain('call limit');
  });

  test('blocks reflect when budget exhausted', async () => {
    const tracker = new UsageTracker({ monthlyBudgetUsd: 0.01, reflectCallLimit: 100 });
    await tracker.init();

    tracker.recordRetain(100000000, true);
    const permission = tracker.canPerformReflect();
    expect(permission.allowed).toBe(false);
  });

  test('tracks errors separately', async () => {
    const tracker = new UsageTracker();
    await tracker.init();

    tracker.recordRetain(undefined, false, 'API error');
    tracker.recordRecall(undefined, true);

    const snapshot = tracker.getSnapshot();
    expect(snapshot.errors).toBe(1);
    expect(snapshot.retainCount).toBe(1);
    expect(snapshot.recallCount).toBe(1);
  });
});

describe('Hindsight Memory Service - Cost Optimization', () => {
  test('service throws on invalid bank ID "default"', async () => {
    expect(() => {
      new HindsightMemoryService(
        'default',
        'test-key',
        'https://api.hindsight.vectorize.io'
      );
    }).toThrow(/must not be "default"/);
  });

  test('service throws on missing bank ID', async () => {
    expect(() => {
      new HindsightMemoryService(
        '',
        'test-key',
        'https://api.hindsight.vectorize.io'
      );
    }).toThrow(/must be set/);
  });

  test('usage tracker starts with zero counts', async () => {
    const service = new HindsightMemoryService(
      'test-bank',
      'test-key',
      'https://api.hindsight.vectorize.io'
    );
    await service.init();
    const observation = service.getUsageSnapshot();
    expect(observation.retainCount).toBe(0);
    expect(observation.recallCount).toBe(0);
    expect(observation.reflectCount).toBe(0);
  });

  test('reflect permission is allowed when under limits', async () => {
    const service = new HindsightMemoryService(
      'test-bank',
      'test-key',
      'https://api.hindsight.vectorize.io'
    );
    await service.init();
    const permission = service.canPerformReflect();
    expect(permission.allowed).toBe(true);
  });
});

describe('Outcome Validation', () => {
  test('verified requires ciResult=passed AND merged=true', () => {
    const errors = validateOutcomeStatus({
      incidentId: 'inc-1',
      status: 'verified',
      ciResult: 'passed',
      merged: true,
    });
    expect(errors).toHaveLength(0);
  });

  test('verified is rejected when ciResult is failed', () => {
    const errors = validateOutcomeStatus({
      incidentId: 'inc-1',
      status: 'verified',
      ciResult: 'failed',
      merged: true,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('CI passed AND change merged');
  });

  test('verified is rejected when merged is false', () => {
    const errors = validateOutcomeStatus({
      incidentId: 'inc-1',
      status: 'verified',
      ciResult: 'passed',
      merged: false,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('CI passed AND change merged');
  });

  test('failed status does not require ciResult or merged', () => {
    const errors = validateOutcomeStatus({
      incidentId: 'inc-1',
      status: 'failed',
    });
    expect(errors).toHaveLength(0);
  });

  test('passed_unmerged does not require merged=true', () => {
    const errors = validateOutcomeStatus({
      incidentId: 'inc-1',
      status: 'passed_unmerged',
      ciResult: 'passed',
      merged: false,
    });
    expect(errors).toHaveLength(0);
  });
});

describe('Secret Redaction', () => {
  test('redacts API keys before retention', () => {
    const text = 'CI job failed: test_payment_retry API_KEY=sk-live-abcdef1234567890';
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain('sk-live-abcdef1234567890');
    expect(redacted).toContain('[REDACTED]');
  });

  test('redacts Authorization Bearer tokens', () => {
    const text = 'Error: timeout Authorization: Bearer ghp_abcdef1234567890';
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain('ghp_abcdef1234567890');
    expect(redacted).toContain('[REDACTED]');
  });

  test('preserves debugging context after redaction', () => {
    const text = 'FAILED test_payment_retry - Error: timeout after 30s waiting for payment gateway mock';
    const redacted = redactSecrets(text);
    expect(redacted).toContain('test_payment_retry');
    expect(redacted).toContain('timeout after 30s');
    expect(redacted).toContain('payment gateway mock');
  });
});
