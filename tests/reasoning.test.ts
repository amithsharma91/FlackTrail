import { describe, test, expect } from 'vitest';
import { analyzeFailure } from '../backend/src/reasoning';
import { ParsedFailure, HistoricalInvestigation } from '../backend/src/shared/types';

describe('AI Reasoning', () => {
  test('produces analysis with no historical memory', async () => {
    const input = {
      parsedFailure: {
        testName: 'test_new_failure',
        errorMessage: 'timeout after 30s',
        failureSignature: 'sig-new',
      } as ParsedFailure,
      historicalInvestigations: [],
    };

    const result = await analyzeFailure(input);
    expect(result.hasRelevantHistory).toBe(false);
    expect(result.confidence).toBe('low');
    expect(result.recommendedSteps.length).toBeGreaterThan(0);
  });

  test('identifies verified approaches from history', async () => {
    const input = {
      parsedFailure: {
        testName: 'test_payment_retry',
        errorMessage: 'timeout after 30s waiting for payment gateway mock',
        failureSignature: 'sig-001',
      } as ParsedFailure,
      historicalInvestigations: [
        {
          id: 'inv-1',
          testName: 'test_payment_retry',
          errorMessage: 'timeout after 30s waiting for payment gateway mock',
          failureSignature: 'sig-001',
          status: 'verified',
          attemptedFix: 'Reset mock state between tests',
          prLink: 'https://github.com/example/pr/1',
          timestamp: '2026-11-01T00:00:00Z',
        } as HistoricalInvestigation,
      ],
    };

    const result = await analyzeFailure(input);
    expect(result.hasRelevantHistory).toBe(true);
    expect(result.verifiedApproaches.length).toBe(1);
    expect(result.verifiedApproaches[0].approach).toContain('Reset mock state');
    expect(result.confidence).toBe('high');
  });

  test('identifies failed approaches from history', async () => {
    const input = {
      parsedFailure: {
        testName: 'test_payment_retry',
        errorMessage: 'timeout after 30s waiting for payment gateway mock',
        failureSignature: 'sig-001',
      } as ParsedFailure,
      historicalInvestigations: [
        {
          id: 'inv-1',
          testName: 'test_payment_retry',
          errorMessage: 'timeout after 30s waiting for payment gateway mock',
          failureSignature: 'sig-001',
          status: 'failed',
          attemptedFix: 'Increase timeout to 60s',
          timestamp: '2026-11-01T00:00:00Z',
        } as HistoricalInvestigation,
      ],
    };

    const result = await analyzeFailure(input);
    expect(result.failedApproaches.length).toBe(1);
    expect(result.failedApproaches[0].approach).toContain('Increase timeout');
  });
});
