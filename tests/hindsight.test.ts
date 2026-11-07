import { describe, test, expect } from 'vitest';
import { HindsightMemoryService } from '../backend/src/hindsight/service';

describe('Hindsight Memory Service', () => {
  test('service throws when SDK not configured', async () => {
    const service = new HindsightMemoryService('test-bank', 'test-key');
    await expect(
      service.recallSimilar('sig-001')
    ).rejects.toThrow('Hindsight SDK not initialized');
  });

  test('service throws on retain when SDK not configured', async () => {
    const service = new HindsightMemoryService('test-bank', 'test-key');
    await expect(
      service.retainInvestigation('inc-1', {
        incidentId: 'inc-1',
        testName: 'test_payment_retry',
        errorMessage: 'timeout',
        failureSignature: 'sig-001',
        outcome: 'verified',
        timestamp: '2026-11-01T00:00:00Z',
      })
    ).rejects.toThrow('Hindsight SDK not initialized');
  });
});
