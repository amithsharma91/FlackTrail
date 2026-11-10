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

  // LLM provider configuration (strict free mode)
  strictFreeMode: process.env.STRICT_FREE_MODE === 'true',

  // OpenRouter
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  openrouterModel: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
  openrouterBaseUrl:
    process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  openrouterEnabled: process.env.OPENROUTER_ENABLED === 'true',

  // Gemini
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  geminiBaseUrl:
    process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
  geminiEnabled: process.env.GEMINI_ENABLED !== 'false',

  // Cloudflare
  cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
  cloudflareModel: process.env.CLOUDFLARE_MODEL || '@cf/zai-org/glm-4.7-flash',
  cloudflareEnabled: process.env.CLOUDFLARE_ENABLED === 'true',

  // Groq
  groqApiKey: process.env.GROQ_API_KEY,
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  groqBaseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
  groqEnabled: process.env.GROQ_ENABLED === 'true',

  // NVIDIA NIM
  nvidiaApiKey: process.env.NVIDIA_API_KEY,
  nvidiaModel: process.env.NVIDIA_MODEL || 'meta/llama-3.1-8b-instruct',
  nvidiaBaseUrl:
    process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  nvidiaEnabled: process.env.NVIDIA_ENABLED === 'true',

  // Z.AI / GLM
  zaiApiKey: process.env.ZAI_API_KEY,
  zaiModel: process.env.ZAI_MODEL || 'glm-4.5',
  zaiBaseUrl: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4',
  zaiEnabled: process.env.ZAI_ENABLED === 'true',

  // Mistral (disabled by default)
  mistralApiKey: process.env.MISTRAL_API_KEY,
  mistralModel: process.env.MISTRAL_MODEL || 'mistral-small-latest',
  mistralBaseUrl:
    process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
  mistralEnabled: process.env.MISTRAL_ENABLED === 'true',

  // SambaNova (disabled by default)
  sambanovaApiKey: process.env.SAMBANOVA_API_KEY,
  sambanovaModel: process.env.SAMBANOVA_MODEL || 'Llama-4-Maverick-17B-128E-Instruct',
  sambanovaBaseUrl:
    process.env.SAMBANOVA_BASE_URL || 'https://api.sambanova.ai/v1',
  sambanovaEnabled: process.env.SAMBANOVA_ENABLED === 'true',
};

export function validateConfig(): string[] {
  const errors: string[] = [];
  if (!config.hindsightApiKey) errors.push('HINDSIGHT_API_KEY is required');
  if (!config.hindsightBankId || config.hindsightBankId === 'default') errors.push('A valid HINDSIGHT_BANK_ID is required');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) errors.push('PORT must be between 1 and 65535');
  if (!config.databasePath) errors.push('DATABASE_PATH is required');
  if (!Number.isFinite(config.hindsightMonthlyBudgetUsd) || config.hindsightMonthlyBudgetUsd < 0) errors.push('HINDSIGHT_MONTHLY_BUDGET_USD must be non-negative');
  if (!Number.isInteger(config.hindsightReflectCallLimit) || config.hindsightReflectCallLimit < 0) errors.push('HINDSIGHT_REFLECT_CALL_LIMIT must be a non-negative integer');

  // At least one LLM provider must have credentials
  const hasAnyProviderKey =
    config.openrouterApiKey ||
    config.geminiApiKey ||
    config.cloudflareApiToken ||
    config.groqApiKey ||
    config.nvidiaApiKey ||
    config.zaiApiKey ||
    config.mistralApiKey ||
    config.sambanovaApiKey;
  if (!hasAnyProviderKey) {
    errors.push('At least one LLM provider API key is required');
  }

  return errors;
}
