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

    const body = ReflectRequestSchema.parse(req.body);

    try {
      const result = await service.executeReflect(body.query, body.context);
      res.status(200).json(result);
    } catch (err: any) {
      if (err.message.includes('REFLECT blocked')) {
        const permission = service.canPerformReflect();
        res.status(403).json({
          error: 'REFLECT call blocked',
          reason: permission.reason || err.message,
          code: 'REFLECT_LIMIT_EXCEEDED',
        });
        return;
      }
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