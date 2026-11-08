import express from 'express';
import cors from 'cors';
import { config } from './config/env';
import { errorHandler, AppError } from './middleware/errorHandler';
import { healthCheck } from './routes/health';
import { analyzeIncident, setHindsightService as setAnalyzeHindsight } from './routes/analyze';
import incidentRoutes, { setHindsightService as setIncidentsHindsight } from './routes/incidents';
import reflectRoutes, { setHindsightService as setReflectHindsight } from './routes/reflect';
import { initDatabase } from './persistence/database';
import { initSchema } from './persistence/schema';
import { initIncidentStore } from './store/incidents';
import { HindsightMemoryService } from './hindsight/service';
import { SQLiteRetentionPersistence } from './persistence/retentionPersistence';
import { SqliteUsagePersistence } from './persistence/usagePersistence';
import { UsageTracker } from './usage';

const app = express();

const corsOrigins = [
  config.frontendUrl,
  ...config.corsOrigins,
].filter(Boolean);

app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: '2mb' }));

// Health check
app.get('/api/health', healthCheck);

// Analyze CI failure
app.post('/api/analyze', analyzeIncident);

// Incidents
app.use('/api/incidents', incidentRoutes);

// Reflect (explicit, optional - not called during normal analysis)
app.use('/api/reflect', reflectRoutes);

// 404 handler
app.use((_req: express.Request, _res: express.Response, next: express.NextFunction) => {
  const err = new AppError('Not found', 404);
  next(err);
});

// Centralized error handler
app.use(errorHandler);

export { app };
export default app;

/**
 * Initialize the application: database, incident store, Hindsight service.
 * Must be called before starting the HTTP server.
 */
export async function initializeApp(): Promise<void> {
  // Initialize SQLite database
  const dbPath = config.databasePath || './data/flakeTrail.db';
  const db = initDatabase(dbPath);

  // Create schema (tables are idempotent via CREATE TABLE IF NOT EXISTS)
  initSchema(db);

  // Initialize incident store with the database
  initIncidentStore(db);

  // Create Hindsight memory service with persistence
  const usagePersistence = new SqliteUsagePersistence(db);
  const usageTracker = new UsageTracker(
    {
      monthlyBudgetUsd: config.hindsightMonthlyBudgetUsd,
      reflectCallLimit: config.hindsightReflectCallLimit,
    },
    usagePersistence
  );
  await usageTracker.init();

  const retentionPersistence = new SQLiteRetentionPersistence(db);
  const hindsightService = new HindsightMemoryService(
    config.hindsightBankId,
    config.hindsightApiKey ?? '',
    config.hindsightApiUrl,
    retentionPersistence,
    usagePersistence
  );

  // Share the Hindsight service instance across route modules
  setAnalyzeHindsight(hindsightService);
  setIncidentsHindsight(hindsightService);
  setReflectHindsight(hindsightService);
}
