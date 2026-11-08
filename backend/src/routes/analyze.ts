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