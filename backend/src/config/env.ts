import dotenv from 'dotenv';

dotenv.config();

export const config = {
  hindsightApiUrl: process.env.HINDSIGHT_API_URL || 'https://api.hindsight.vectorize.io',
  hindsightApiKey: process.env.HINDSIGHT_API_KEY,
  hindsightBankId: process.env.HINDSIGHT_BANK_ID || 'flaketrail-ci-memory',
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [],
  databasePath: process.env.DATABASE_PATH || './data/flakeTrail.db',
  hindsightMonthlyBudgetUsd: parseFloat(process.env.HINDSIGHT_MONTHLY_BUDGET_USD || '4.75'),
  hindsightReflectCallLimit: parseInt(process.env.HINDSIGHT_REFLECT_CALL_LIMIT || '10', 10),
};

export function validateConfig(): string[] {
  const errors: string[] = [];
  if (!config.hindsightApiKey) errors.push('HINDSIGHT_API_KEY is required');
  if (!config.hindsightBankId || config.hindsightBankId === 'default') errors.push('A valid HINDSIGHT_BANK_ID is required');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) errors.push('PORT must be between 1 and 65535');
  if (!config.databasePath) errors.push('DATABASE_PATH is required');
  if (!Number.isFinite(config.hindsightMonthlyBudgetUsd) || config.hindsightMonthlyBudgetUsd < 0) errors.push('HINDSIGHT_MONTHLY_BUDGET_USD must be non-negative');
  if (!Number.isInteger(config.hindsightReflectCallLimit) || config.hindsightReflectCallLimit < 0) errors.push('HINDSIGHT_REFLECT_CALL_LIMIT must be a non-negative integer');
  return errors;
}