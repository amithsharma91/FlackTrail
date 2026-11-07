import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  ReflectRequestSchema,
  ReflectRequestInput,
} from '../shared/index';
import { HindsightMemoryService } from '../hindsight/service';
import { config } from '../config/env';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

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
      config.hindsightApiKey,
      config.hindsightApiUrl
    );
  }
  return hindsightService;
}

/**
 * POST /api/reflect
 *
 * EXPLICIT, optional REFLECT operation.
 *
 * This endpoint is NOT called during normal analysis. It is available
 * only when the user explicitly asks Hindsight about investigation history
 * or requests a historical investigation summary.
 *
 * Before invoking, the caller should check canPerformReflect() to ensure
 * the REFLECT call limit and budget have not been exceeded.
 *
 * REFLECT costs $0.05 per call. Do not automatically retry on failure.
 */
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const service = getHindsightService();

    // Check if REFLECT is allowed before invoking
    const permission = service.canPerformReflect();
    if (!permission.allowed) {
      res.status(403).json({
        error: 'REFLECT call blocked',
        reason: permission.reason,
        code: 'REFLECT_LIMIT_EXCEEDED',
      });
      return;
    }

    const body = ReflectRequestSchema.parse(req.body);

    try {
      const result = await service.reflectOnInvestigation(
        body.query,
        body.context
      );
      res.status(200).json(result);
    } catch (err: any) {
      res.status(500).json({
        error: 'REFLECT failed',
        message: err.message,
      });
    }
  })
);

/**
 * GET /api/reflect/permission
 *
 * Check whether REFLECT can be called without actually invoking it.
 * Returns budget status and permission details.
 */
router.get(
  '/permission',
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const service = getHindsightService();
    const permission = service.canPerformReflect();
    const budget = service.getBudgetStatus();
    const usage = service.getUsageSnapshot();

    res.status(200).json({
      allowed: permission.allowed,
      reason: permission.reason,
      budget,
      usage: {
        reflectCount: usage.reflectCount,
        reflectCallLimit: config.hindsightReflectCallLimit,
        totalEstimatedCost: usage.totalEstimatedCost,
      },
    });
  })
);

export default router;
