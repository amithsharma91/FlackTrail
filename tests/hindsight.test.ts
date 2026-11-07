import { describe, test, expect } from 'vitest';
import { HindsightMemoryService } from '../backend/src/hindsight/service';

describe('Hindsight Memory Service', () => {
  test('service throws on recall when SDK call fails', async () => {
    const service = new HindsightMemoryService(
      'test-bank',
      'invalid-key',
      'https://api.hindsight.vectorize.io'
    );
    await expect(
      service.recallSimilar('sig-001')
    ).rejects.toThrow('Hindsight recall failed');
  });

  test('service throws on retain when SDK call fails', async () => {
    const service = new HindsightMemoryService(
      'test-bank',
      'invalid-key',
      'https://api.hindsight.vectorize.io'
    );
    await expect(
      service.retainInvestigation('inc-1', {
        incidentId: 'inc-1',
        testName: 'test_payment_retry',
        errorMessage: 'timeout',
        failureSignature: 'sig-001',
        outcome: 'verified',
        timestamp: '2026-11-01T00:00:00Z',
      })
    ).rejects.toThrow('Hindsight retain failed');
  });

  test('service rejects invalid bank ID "default"', () => {
    expect(() => {
      new HindsightMemoryService(
        'default',
        'test-key',
        'https://api.hindsight.vectorize.io'
      );
    }).toThrow(/must not be "default"/);
  });

  test('service rejects missing bank ID', () => {
    expect(() => {
      new HindsightMemoryService(
        '',
        'test-key',
        'https://api.hindsight.vectorize.io'
      );
    }).toThrow(/must be set/);
  });
});
