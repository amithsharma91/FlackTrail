import { describe, test, expect } from 'vitest';
import { validateOutcomeStatus } from '../backend/src/shared/schemas';

describe('Outcome Status Validation', () => {
  test('verified requires ciResult=passed AND merged=true', () => {
    const errors = validateOutcomeStatus({
      incidentId: 'inc-1',
      status: 'verified',
      ciResult: 'passed',
      merged: true,
    });
    expect(errors).toHaveLength(0);
  });

  test('verified without merged is invalid', () => {
    const errors = validateOutcomeStatus({
      incidentId: 'inc-1',
      status: 'verified',
      ciResult: 'passed',
      merged: false,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('CI passed AND change merged');
  });

  test('verified without ciResult=passed is invalid', () => {
    const errors = validateOutcomeStatus({
      incidentId: 'inc-1',
      status: 'verified',
      ciResult: 'failed',
      merged: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  test('failed status does not require ciResult or merged', () => {
    const errors = validateOutcomeStatus({
      incidentId: 'inc-1',
      status: 'failed',
    });
    expect(errors).toHaveLength(0);
  });

  test('passed_unmerged status does not require merged', () => {
    const errors = validateOutcomeStatus({
      incidentId: 'inc-1',
      status: 'passed_unmerged',
      ciResult: 'passed',
      merged: false,
    });
    expect(errors).toHaveLength(0);
  });
});
