import express from 'express';
import cors from 'cors';
import { config } from './config/env';
import { errorHandler, AppError } from './middleware/errorHandler';
import { healthCheck } from './routes/health';
import { analyzeIncident } from './routes/analyze';
import incidentRoutes from './routes/incidents';

const app = express();

app.use(cors({ origin: config.frontendUrl }));
app.use(express.json({ limit: '2mb' }));

// Health check
app.get('/api/health', healthCheck);

// Analyze CI failure
app.post('/api/analyze', analyzeIncident);

// Incidents
app.use('/api/incidents', incidentRoutes);

// 404 handler
app.use((_req: express.Request, _res: express.Response, next: express.NextFunction) => {
  const err = new AppError('Not found', 404);
  next(err);
});

// Centralized error handler
app.use(errorHandler);

export { app };
export default app;
