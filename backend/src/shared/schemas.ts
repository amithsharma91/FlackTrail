import { z } from 'zod';

export const AnalyzeRequestSchema = z.object({
  logText: z.string().min(1, 'CI log text is required'),
  fileName: z.string().optional(),
});

export type AnalyzeRequestInput = z.infer<typeof AnalyzeRequestSchema>;

/**
 * Structured output every LLM provider must return for CI failure analysis.
 * Historical evidence fields are assembled server-side from Hindsight memories
 * so a model cannot invent provenance.
 */
export const LLMAnalysisSchema = z.object({
  failureSummary: z.string().trim().min(1),
  possibleCauses: z
    .array(
      z.object({
        cause: z.string().trim().min(1),
        evidence: z.array(z.string().trim().min(1)).min(1),
        confidence: z.enum(['low', 'medium', 'high']),
      })
    )
    .min(1),
  recommendedSteps: z.array(z.string().trim().min(1)).min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  uncertaintyExplanation: z.string().trim().min(1),
});

export type LLMAnalysisOutput = z.infer<typeof LLMAnalysisSchema>;

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

export const ReflectRequestSchema = z.object({
  query: z.string().min(1, 'Reflect query is required'),
  context: z.string().optional(),
});

export type ReflectRequestInput = z.infer<typeof ReflectRequestSchema>;
