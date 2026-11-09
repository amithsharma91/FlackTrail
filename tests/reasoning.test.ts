import { describe, test, expect, vi, afterEach } from 'vitest';
import {
  AIAnalysisFormatError,
  analyzeFailure,
  analyzeFailureDetailed,
  setAnalysisOrchestrator,
} from '../backend/src/reasoning';
import { AllProvidersFailedError } from '../backend/src/llm/orchestrator';
import {
  ParsedFailure,
  HistoricalInvestigation,
} from '../backend/src/shared/types';
import type {
  OrchestratorRequest,
  OrchestratorResponse,
} from '../backend/src/llm/types';

const validAnalysis = {
  failureSummary: 'The payment gateway mock timed out.',
  possibleCauses: [
    {
      cause: 'Shared mock state is not reset between tests.',
      evidence: ['Timeout waiting for payment gateway mock'],
      confidence: 'high',
    },
  ],
  recommendedSteps: ['Reset the mock state between tests.'],
  confidence: 'high',
  uncertaintyExplanation: 'A verified memory supports this cause.',
};

interface FakeOptions {
  content?: string;
  provider?: string;
  model?: string;
  attempts?: number;
  fallbackUsed?: boolean;
  invokeValidate?: boolean;
  rejectWith?: unknown;
}

function installFakeOrchestrator(options: FakeOptions = {}) {
  const requestRef: { current?: OrchestratorRequest } = {};
  const generateWithFallback = vi.fn(
    async (request: OrchestratorRequest): Promise<OrchestratorResponse> => {
      requestRef.current = request;

      if (options.rejectWith) throw options.rejectWith;

      const response: OrchestratorResponse = {
        content: options.content ?? JSON.stringify(validAnalysis),
        provider: options.provider ?? 'openrouter',
        model: options.model ?? 'openrouter/free',
        latencyMs: 12,
        attempts: options.attempts ?? 1,
        fallbackUsed: options.fallbackUsed ?? false,
        usage: { inputTokens: 100, outputTokens: 40 },
      };

      if (options.invokeValidate !== false && request.validate) {
        await request.validate(response);
      }

      return response;
    }
  );

  const orchestrator = { generateWithFallback };
  setAnalysisOrchestrator(orchestrator);
  return { orchestrator, requestRef };
}

function parsedFailure(overrides: Partial<ParsedFailure> = {}): ParsedFailure {
  return {
    testName: 'test_payment_retry',
    errorMessage: 'timeout after 30s waiting for payment gateway mock',
    failureSignature: 'sig-001',
    ...overrides,
  };
}

function verifiedMemory(): HistoricalInvestigation {
  return {
    id: 'inv-1',
    testName: 'test_payment_retry',
    errorMessage: 'timeout after 30s waiting for payment gateway mock',
    failureSignature: 'sig-001',
    status: 'verified',
    attemptedFix: 'Reset mock state between tests',
    prLink: 'https://github.com/example/pr/1',
    timestamp: '2026-11-01T00:00:00Z',
  };
}

afterEach(() => {
  setAnalysisOrchestrator(null);
});

describe('AI Reasoning - validated LLM analysis', () => {
  test('uses the LLM result and reports no history when none exists', async () => {
    installFakeOrchestrator();

    const result = await analyzeFailureDetailed({
      parsedFailure: parsedFailure(),
      historicalInvestigations: [],
    });

    expect(result.analysis.failureSummary).toBe(validAnalysis.failureSummary);
    expect(result.analysis.recommendedSteps).toEqual(
      validAnalysis.recommendedSteps
    );
    expect(result.analysis.possibleCauses).toEqual(
      validAnalysis.possibleCauses
    );
    expect(result.analysis.hasRelevantHistory).toBe(false);
    expect(result.analysis.verifiedApproaches).toEqual([]);
    expect(result.analysis.failedApproaches).toEqual([]);
    expect(result.diagnostics.provider).toBe('openrouter');
    expect(result.diagnostics.model).toBe('openrouter/free');
    expect(result.diagnostics.usage?.inputTokens).toBe(100);
  });

  test('derives verified approaches from recalled memories, not model output', async () => {
    installFakeOrchestrator();

    const result = await analyzeFailureDetailed({
      parsedFailure: parsedFailure(),
      historicalInvestigations: [verifiedMemory()],
    });

    expect(result.analysis.hasRelevantHistory).toBe(true);
    expect(result.analysis.relevantHistoricalIncidents).toHaveLength(1);
    expect(result.analysis.verifiedApproaches).toEqual([
      {
        approach: 'Reset mock state between tests',
        incidentId: 'inv-1',
        prLink: 'https://github.com/example/pr/1',
      },
    ]);
  });

  test('derives failed approaches from recalled memories', async () => {
    installFakeOrchestrator();

    const failed: HistoricalInvestigation = {
      ...verifiedMemory(),
      id: 'inv-2',
      status: 'failed',
      attemptedFix: 'Increase timeout to 60s',
      prLink: undefined,
    };

    const result = await analyzeFailureDetailed({
      parsedFailure: parsedFailure(),
      historicalInvestigations: [failed],
    });

    expect(result.analysis.failedApproaches).toEqual([
      { approach: 'Increase timeout to 60s', incidentId: 'inv-2' },
    ]);
    expect(result.analysis.verifiedApproaches).toEqual([]);
  });

  test('caps memories sent to the provider at five', async () => {
    const { requestRef } = installFakeOrchestrator();

    const memories = Array.from({ length: 9 }, (_, index) => ({
      ...verifiedMemory(),
      id: `mem-${index}`,
    }));

    await analyzeFailureDetailed({
      parsedFailure: parsedFailure(),
      historicalInvestigations: memories,
    });

    const payload = JSON.parse(
      requestRef.current?.messages[1].content.split('\n\n')[1] ?? '{}'
    );
    expect(payload.relevantHistoricalMemories).toHaveLength(5);
  });

  test('rejects malformed JSON instead of returning rule-based output', async () => {
    installFakeOrchestrator({
      content: 'The model refused to return JSON.',
      invokeValidate: false,
    });

    await expect(
      analyzeFailure({
        parsedFailure: parsedFailure(),
        historicalInvestigations: [],
      })
    ).rejects.toBeInstanceOf(AIAnalysisFormatError);
  });

  test('rejects structurally invalid JSON', async () => {
    installFakeOrchestrator({
      content: JSON.stringify({ failureSummary: 'missing required fields' }),
      invokeValidate: false,
    });

    await expect(
      analyzeFailure({
        parsedFailure: parsedFailure(),
        historicalInvestigations: [],
      })
    ).rejects.toBeInstanceOf(AIAnalysisFormatError);
  });

  test('accepts JSON wrapped in a markdown code fence', async () => {
    installFakeOrchestrator({
      content: '```json\n' + JSON.stringify(validAnalysis) + '\n```',
    });

    const result = await analyzeFailure({
      parsedFailure: parsedFailure(),
      historicalInvestigations: [],
    });

    expect(result.failureSummary).toBe(validAnalysis.failureSummary);
  });

  test('redacts secrets from the failure and memories before the LLM call', async () => {
    const { requestRef } = installFakeOrchestrator();

    await analyzeFailureDetailed({
      parsedFailure: parsedFailure({
        errorMessage:
          'Authorization: Bearer ghp_abcdef1234567890 and API_KEY=sk-live-abcdef1234567890',
        stackTrace: 'password=hunter2',
      }),
      historicalInvestigations: [
        {
          ...verifiedMemory(),
          errorMessage: 'token=super-secret-token',
          attemptedFix: 'Use password=hunter2',
        },
      ],
    });

    const sent = JSON.stringify(requestRef.current?.messages);
    expect(sent).not.toContain('ghp_abcdef1234567890');
    expect(sent).not.toContain('sk-live-abcdef1234567890');
    expect(sent).not.toContain('hunter2');
    expect(sent).not.toContain('super-secret-token');
    expect(sent).toContain('[REDACTED');
  });

  test('does not invent history when the model returns historical claims', async () => {
    installFakeOrchestrator({
      content: JSON.stringify({
        ...validAnalysis,
        relevantHistoricalIncidents: [{ id: 'fake-incident' }],
        verifiedApproaches: [{ approach: 'fake fix', incidentId: 'fake' }],
        failedApproaches: [{ approach: 'fake failure', incidentId: 'fake' }],
        hasRelevantHistory: true,
      }),
    });

    const result = await analyzeFailure({
      parsedFailure: parsedFailure(),
      historicalInvestigations: [],
    });

    expect(result.hasRelevantHistory).toBe(false);
    expect(result.relevantHistoricalIncidents).toEqual([]);
    expect(result.verifiedApproaches).toEqual([]);
    expect(result.failedApproaches).toEqual([]);
  });

  test('propagates provider failure instead of falling back to rules', async () => {
    installFakeOrchestrator({
      rejectWith: new AllProvidersFailedError([
        {
          provider: 'openrouter',
          kind: 'transport',
          statusCode: 401,
          retryable: false,
          message: 'Unauthorized',
        },
      ]),
    });

    await expect(
      analyzeFailure({
        parsedFailure: parsedFailure(),
        historicalInvestigations: [],
      })
    ).rejects.toBeInstanceOf(AllProvidersFailedError);
  });
});

describe('AI Reasoning - all providers produce the same validated structure', () => {
  test.each([
    ['openrouter', 'openrouter/free'],
    ['gemini', 'gemini-1.5-flash'],
    ['cloudflare', '@cf/google/gemma-4-26b-a4b-it'],
  ])('%s output validates to the same AIAnalysis contract', async (provider, model) => {
    installFakeOrchestrator({ provider, model });

    const result = await analyzeFailureDetailed({
      parsedFailure: parsedFailure(),
      historicalInvestigations: [verifiedMemory()],
    });

    expect(result.diagnostics.provider).toBe(provider);
    expect(result.diagnostics.model).toBe(model);
    expect(Object.keys(result.analysis).sort()).toEqual(
      [
        'confidence',
        'failedApproaches',
        'failureSummary',
        'hasRelevantHistory',
        'possibleCauses',
        'recommendedSteps',
        'relevantHistoricalIncidents',
        'uncertaintyExplanation',
        'verifiedApproaches',
      ].sort()
    );
    expect(result.analysis.possibleCauses).toEqual(
      validAnalysis.possibleCauses
    );
  });
});
