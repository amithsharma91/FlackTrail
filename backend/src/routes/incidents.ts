import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { OutcomeSubmissionSchema, validateOutcomeStatus } from '../shared/index';

const incidents: Map<string, any> = new Map();

const router = Router();

router.get('/', async (_req: Request, res: Response): Promise<void> => {
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
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const incident = incidents.get(req.params.id);
  if (!incident) {
    res.status(404).json({ error: 'Incident not found', status: 404 });
    return;
  }
  res.status(200).json(incident);
});

router.post('/:id/resolve', async (req: Request, res: Response): Promise<void> => {
  const incident = incidents.get(req.params.id);
  if (!incident) {
    res.status(404).json({ error: 'Incident not found', status: 404 });
    return;
  }

  const submission = OutcomeSubmissionSchema.parse({
    ...req.body,
    incidentId: req.params.id,
  });

  const statusErrors = validateOutcomeStatus(submission);
  if (statusErrors.length > 0) {
    res.status(400).json({ error: statusErrors.join(', '), status: 400 });
    return;
  }

  incident.status = submission.status;
  incident.outcome = {
    incidentId: submission.incidentId,
    status: submission.status,
    fixDescription: submission.fixDescription,
    ciResult: submission.ciResult,
    merged: submission.merged,
    prLink: submission.prLink,
    notes: submission.notes,
  };

  incidents.set(submission.incidentId, incident);

  res.status(200).json({
    success: true,
    status: submission.status,
  });
});

export default router;
