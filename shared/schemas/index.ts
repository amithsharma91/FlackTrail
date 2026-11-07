import { z } from 'zod';

export const AnalyzeRequestSchema = z.object({
  logText: z.string().min(1, 'CI log text is required'),
  fileName: z.string().optional(),
});

export type AnalyzeRequestInput = z.infer<typeof AnalyzeRequestSchema>;

export const OutcomeSubmissionSchema = z.object({
  incidentId: z.string().min(1, 'Incident ID is required'),
  status: z.enum(['proposed', 'failed', 'passed_unmerged', 'verified']),
  fixDescription: z.string().optional(),
  ciResult: z.enum(['passed', 'failed']).optional(),
  merged: z.boolean().optional(),
  prLink: z.string().url().optional().nullable(),
  notes: z.string().optional(),
});

export type OutcomeSubmissionInput = z.infer<typeof OutcomeSubmissionSchema>;

// Verified status requires ciResult=passed AND merged=true
export function validateOutcomeStatus(data: OutcomeSubmissionInput): string[] {
  const errors: string[] = [];
  if (data.status === 'verified' && (data.ciResult !== 'passed' || data.merged !== true)) {
    errors.push('Verified status requires CI passed AND change merged');
  }
  return errors;
}
