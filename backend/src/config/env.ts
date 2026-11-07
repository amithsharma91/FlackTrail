import dotenv from 'dotenv';
dotenv.config();

export const config = {
  hindsightApiKey: process.env.HINDSIGHT_API_KEY,
  hindsightBankId: process.env.HINDSIGHT_BANK_ID,
  llmProvider: process.env.LLM_PROVIDER || 'openai',
  llmApiKey: process.env.LLM_API_KEY,
  llmModel: process.env.LLM_MODEL || 'gpt-4o-mini',
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};

export function validateConfig(): string[] {
  const errors: string[] = [];
  if (!config.hindsightApiKey) errors.push('HINDSIGHT_API_KEY is required');
  if (!config.hindsightBankId) errors.push('HINDSIGHT_BANK_ID is required');
  if (!config.llmApiKey) errors.push('LLM_API_KEY is required');
  return errors;
}
