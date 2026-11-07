import {
  ParsedFailure,
  HistoricalInvestigation,
  AIAnalysis,
} from '../shared/index';

export interface ReasoningInput {
  parsedFailure: ParsedFailure;
  historicalInvestigations: HistoricalInvestigation[];
}

export async function analyzeFailure(
  input: ReasoningInput
): Promise<AIAnalysis> {
  const { parsedFailure, historicalInvestigations } = input;

  const verifiedApproaches = historicalInvestigations.filter(
    (i) => i.status === 'verified'
  );
  const failedApproaches = historicalInvestigations.filter(
    (i) => i.status === 'failed'
  );
  const passedUnmerged = historicalInvestigations.filter(
    (i) => i.status === 'passed_unmerged'
  );

  const hasRelevantHistory = historicalInvestigations.length > 0;

  // Build likely cause from verified fixes if available, otherwise from failed attempts
  let likelyCause = '';
  let confidence: 'low' | 'medium' | 'high' = 'low';
  let uncertaintyExplanation = '';

  if (verifiedApproaches.length > 0) {
    likelyCause = `Based on ${verifiedApproaches.length} verified fix(es), the most likely cause is related to the pattern seen in: ${verifiedApproaches.map((a) => a.testName).join(', ')}.`;
    confidence = 'high';
    uncertaintyExplanation =
      'This recommendation is based on previously verified fixes. Always verify in CI before merging.';
  } else if (failedApproaches.length > 0) {
    likelyCause = `No verified fix found. ${failedApproaches.length} previous attempt(s) failed. The cause is likely related to: ${parsedFailure.errorMessage}.`;
    confidence = 'medium';
    uncertaintyExplanation =
      'No verified fix exists in memory. Previous attempts failed, so proceed with caution and verify thoroughly in CI.';
  } else if (passedUnmerged.length > 0) {
    likelyCause = `A fix passed CI but was not merged. The likely cause relates to: ${parsedFailure.errorMessage}.`;
    confidence = 'medium';
    uncertaintyExplanation =
      'A fix passed CI but was not merged, so it is not yet a confirmed solution.';
  } else {
    likelyCause = `No relevant historical memory found for this failure signature. The error is: ${parsedFailure.errorMessage}.`;
    confidence = 'low';
    uncertaintyExplanation =
      'No historical memory available. This is a new failure pattern; investigate from first principles.';
  }

  const possibleCauses = [
    {
      cause: likelyCause,
      evidence: [
        `Error message: ${parsedFailure.errorMessage}`,
        `Test: ${parsedFailure.testName}`,
        ...(parsedFailure.stackTrace ? ['Stack trace present'] : []),
      ],
      confidence,
    },
  ];

  const recommendedSteps: string[] = [];

  if (verifiedApproaches.length > 0) {
    recommendedSteps.push(
      `Try the verified fix: ${verifiedApproaches[0].attemptedFix || 'review the verified approach'}`
    );
    recommendedSteps.push(
      `Reference: ${verifiedApproaches[0].prLink || 'verified PR linked in memory'}`
    );
  } else {
    recommendedSteps.push(
      'Review the error message and stack trace to identify the root cause.'
    );
    recommendedSteps.push(
      'Check if any recent changes introduced the failing pattern.'
    );
    recommendedSteps.push(
      'Apply a fix, run CI, and record the outcome in FlakeTrail.'
    );
  }

  if (failedApproaches.length > 0) {
    recommendedSteps.push(
      `Avoid: ${failedApproaches.map((a) => a.attemptedFix || 'previous failed attempt').join(', ')} - these were already tried and failed.`
    );
  }

  return {
    failureSummary: `Test "${parsedFailure.testName}" failed with: ${parsedFailure.errorMessage}`,
    possibleCauses,
    relevantHistoricalIncidents: historicalInvestigations,
    failedApproaches: failedApproaches.map((a) => ({
      approach: a.attemptedFix || 'unknown approach',
      incidentId: a.id,
    })),
    verifiedApproaches: verifiedApproaches.map((a) => ({
      approach: a.attemptedFix || 'unknown approach',
      incidentId: a.id,
      prLink: a.prLink,
    })),
    recommendedSteps,
    confidence,
    uncertaintyExplanation,
    hasRelevantHistory,
  };
}
