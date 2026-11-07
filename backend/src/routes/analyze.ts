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
import { parseCILog } from '../parser';
import { HindsightMemoryService } from '../hindsight/service';
import { analyzeFailure } from '../reasoning';
import { config } from '../config/env';
import { asyncHandler, AppError } from '../middleware/errorHandler';

let hindsightService: HindsightMemoryService | null = null;

function getHindsightService(): HindsightMemoryService {
  if (!hindsightService) {
    if (!config.hindsightApiKey || !config.hindsightBankId) {
      throw new AppError(
        'Hindsight not configured. Set HINDSIGHT_API_KEY and HINDSIGHT_BANK_ID.',
        500
      );
    }
    hindsightService = new HindsightMemoryService(
      config.hindsightBankId,
      config.hindsightApiKey
    );
  }
  return hindsightService;
}

let incidentCounter = 0;
const incidents: Map<string, any> = new Map();

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
    const incidentId = `inc-${Date.now()}-${++incidentCounter}`;

    // Step 3: Hindsight RECALL - retrieve similar historical investigations
    let historicalInvestigations: HistoricalInvestigation[] = [];
    try {
      const service = getHindsightService();
      historicalInvestigations = await service.recallSimilar(
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

    // Step 4: AI reasoning
    let aiAnalysis: AIAnalysis;
    try {
      aiAnalysis = await analyzeFailure({
        parsedFailure,
        historicalInvestigations,
      });
    } catch (err: any) {
      throw new AppError(`AI analysis failed: ${err.message}`, 500);
    }

    // Step 5: Store incident locally (in-memory for MVP)
    const incident: any = {
      id: incidentId,
      parsedFailure,
      historicalInvestigations,
      aiAnalysis,
      status: 'proposed',
      outcome: undefined,
      createdAt: new Date().toISOString(),
    };
    incidents.set(incidentId, incident);

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
    const incidentList = Array.from(incidents.values()).map((inc: any) => ({
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
    const incident = incidents.get(req.params.id);
    if (!incident) {
      throw new AppError('Incident not found', 404);
    }
    res.status(200).json(incident);
  }
);

export const resolveIncident = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const incident = incidents.get(req.params.id);
    if (!incident) {
      throw new AppError('Incident not found', 404);
    }

    // Validate outcome submission
    const submission = OutcomeSubmissionSchema.parse({
      ...req.body,
      incidentId: req.params.id,
    });

    const statusErrors = validateOutcomeStatus(submission);
    if (statusErrors.length > 0) {
      throw new AppError(statusErrors.join(', '), 400);
    }

    // Store outcome
    incident.status = submission.status;
    incident.outcome = {
      incidentId: submission.incidentId,
      status: submission.status,
      fixDescription: submission.fixDescription,
      ciResult: submission.ciResult,
      merged: submission.merged,
      prLink: submission.prLink ?? undefined,
      notes: submission.notes ?? undefined,
    };

    // Step: Hindsight RETAIN - store the confirmed outcome
    try {
      const service = getHindsightService();
      await service.retainInvestigation(submission.incidentId, {
        incidentId: submission.incidentId,
        testName: incident.parsedFailure.testName,
        errorMessage: incident.parsedFailure.errorMessage,
        failureSignature: incident.parsedFailure.failureSignature,
        environment: incident.parsedFailure.environment,
        attemptedFix: submission.fixDescription,
        outcome: submission.status,
        ciResult: submission.ciResult,
        merged: submission.merged,
        prLink: submission.prLink ?? undefined,
        notes: submission.notes ?? undefined,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      // If Hindsight retain fails, we still return success locally but warn
      console.warn('Hindsight retain warning:', err.message);
    }

    incidents.set(submission.incidentId, incident);

    res.status(200).json({
      success: true,
      status: submission.status,
    });
  }
);
