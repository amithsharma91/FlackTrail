import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  AnalyzeRequestSchema,
  AnalyzeResponse,
  ParsedFailure,
  HistoricalInvestigation,
  AIAnalysis,
  OutcomeSubmissionSchema,
  validateOutcomeStatus,
} from '../shared/index';
import { parseCILog, redactSecrets } from '../parser';
import { HindsightMemoryService } from '../hindsight/service';
import { analyzeFailureDetailed, AIAnalysisFormatError } from '../reasoning';
import { AllProvidersFailedError } from '../llm/orchestrator';
import { config } from '../config/env';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import {
  createIncident,
  getIncidentById,
  listAllIncidents,
  updateIncident,
} from '../store/incidents';

let hindsightService: HindsightMemoryService | null = null;

export function setHindsightService(service: HindsightMemoryService): void {
  hindsightService = service;
}

function getHindsightService(): HindsightMemoryService {
  if (!hindsightService) {
    throw new AppError(
      'Hindsight not initialized. Call initializeApp() first.',
      500
    );
  }
  return hindsightService;
}

export const analyzeIncident = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const parsed = AnalyzeRequestSchema.parse(req.body);

    const { logText } = parsed;

    // Step 1: Parse CI log
    let parsedFailure: ParsedFailure;
    try {
      parsedFailure = parseCILog(logText, parsed.fileName);
    } catch (err: any) {
      throw new AppError(`Failed to parse CI log: ${err.message}`, 400);
    }

    // Step 2: Create incident ID
    const incidentId = `inc-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    // Step 3: Hindsight RECALL - retrieve similar historical investigations
    // NOTE: Normal analysis calls RECALL only. REFLECT is never called here.
    let historicalInvestigations: HistoricalInvestigation[] = [];
    try {
      const service = getHindsightService();
      historicalInvestigations = await service.recallSimilarTracked(
        parsedFailure.failureSignature,
        [
          `test:${parsedFailure.testName}`,
          `ci:${parsedFailure.ciJobId || 'unknown'}`,
        ]
      );
    } catch (err: any) {
      // Hindsight failure is not fatal; we continue with empty history
      console.warn('Hindsight recall warning:', err.message);
      historicalInvestigations = [];
    }

    // Safety cap: pass at most 5 memories to reasoning
    historicalInvestigations = historicalInvestigations.slice(0, 5);

    // Step 4: AI reasoning (genuine LLM call through the existing registry)
    let aiAnalysis: AIAnalysis;
    try {
      const analysisResult = await analyzeFailureDetailed({
        parsedFailure,
        historicalInvestigations,
      });
      aiAnalysis = analysisResult.analysis;

      // Server-side diagnostics only; no prompts or credentials are logged.
      console.info(
        '[llm-analysis] success',
        JSON.stringify({
          incidentId,
          provider: analysisResult.diagnostics.provider,
          model: analysisResult.diagnostics.model,
          attempts: analysisResult.diagnostics.attempts,
          fallbackUsed: analysisResult.diagnostics.fallbackUsed,
          latencyMs: analysisResult.diagnostics.latencyMs,
          inputTokens: analysisResult.diagnostics.usage?.inputTokens ?? null,
          outputTokens: analysisResult.diagnostics.usage?.outputTokens ?? null,
          memoryCount: historicalInvestigations.length,
        })
      );
    } catch (err: any) {
      if (err instanceof AllProvidersFailedError) {
        console.error(
          '[llm-analysis] all providers failed',
          JSON.stringify({
            incidentId,
            validationOnly: err.hasOnlyValidationFailures(),
            attempts: err.attempts.map((attempt) => ({
              provider: attempt.provider,
              kind: attempt.kind,
              statusCode: attempt.statusCode ?? null,
              retryable: attempt.retryable,
              message: redactSecrets(attempt.message).slice(0, 300),
            })),
          })
        );

        // If every provider returned validation failures (bad structured output),
        // return 502.
        if (err.hasOnlyValidationFailures()) {
          throw new AppError(
            'AI analysis failed: all providers returned malformed analysis',
            502
          );
        }

        // Determine the most appropriate user-facing error based on the
        // accumulated provider attempts. Authentication failures (401/403)
        // are non-retryable and should surface immediately.
        const authFailure = err.attempts.find(
          (a) => a.statusCode === 401 || a.statusCode === 403
        );
        if (authFailure) {
          throw new AppError(
            'AI provider authentication failed. Please contact the administrator.',
            authFailure.statusCode ?? 500
          );
        }

        // Rate limit exceeded (429) - tell the user to retry shortly
        const rateLimitFailure = err.attempts.find(
          (a) => a.statusCode === 429
        );
        if (rateLimitFailure) {
          throw new AppError(
            'AI request limit reached. Please try again shortly.',
            429
          );
        }

        // Gateway timeout (504) - the request timed out
        const timeoutFailure = err.attempts.find(
          (a) => a.statusCode === 504
        );
        if (timeoutFailure) {
          throw new AppError(
            'AI analysis timed out. Please retry.',
            504
          );
        }

        // Default: all providers failed with transient errors (5xx)
        throw new AppError(
          'AI analysis unavailable: all configured LLM providers failed',
          503
        );
      }

      if (err instanceof AIAnalysisFormatError) {
        console.error(
          '[llm-analysis] malformed response',
          JSON.stringify({
            incidentId,
            message: redactSecrets(err.message).slice(0, 300),
          })
        );
        throw new AppError(
          'AI analysis failed: the model returned malformed analysis',
          502
        );
      }

      console.error(
        '[llm-analysis] unexpected failure',
        JSON.stringify({
          incidentId,
          message: redactSecrets(err?.message ?? String(err)).slice(0, 300),
        })
      );
      throw new AppError('AI analysis failed', 500);
    }

    // Step 5: Store incident in persistent store
    const incident: any = {
      id: incidentId,
      parsedFailure,
      historicalInvestigations,
      aiAnalysis,
      status: 'proposed',
      outcome: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    createIncident(incident);

    const response: AnalyzeResponse = {
      incidentId,
      parsedFailure,
      historicalInvestigations,
      aiAnalysis,
    };

    res.status(200).json(response);
  }
);

export const listIncidents = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    const incidentList = listAllIncidents().map((inc: any) => ({
      id: inc.id,
      testName: inc.parsedFailure.testName,
      errorMessage: inc.parsedFailure.errorMessage,
      failureSignature: inc.parsedFailure.failureSignature,
      status: inc.status,
      attemptedFix: inc.outcome?.fixDescription,
      ciJobId: inc.parsedFailure.ciJobId,
      ciBranch: inc.parsedFailure.ciBranch,
      prLink: inc.outcome?.prLink,
      timestamp: inc.createdAt,
      source: inc.id,
    }));
    res.status(200).json({ incidents: incidentList });
  }
);

export const getIncident = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const incident = getIncidentById(req.params.id);
    if (!incident) {
      throw new AppError('Incident not found', 404);
    }
    res.status(200).json(incident);
  }
);