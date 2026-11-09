// Test environment setup for FlakeTrail QA suite.
// Sets deterministic environment variables before backend modules load so that
// dotenv.config() (in backend/src/config/env) does not override them and no
// real Hindsight / LLM credentials are required. All external calls are mocked.
process.env.HINDSIGHT_API_KEY = 'test-hindsight-key';
process.env.HINDSIGHT_BANK_ID = 'flaketrail-ci-memory';
process.env.HINDSIGHT_API_URL = 'https://api.hindsight.vectorize.io';
process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.OPENROUTER_MODEL = 'openrouter/free';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.GEMINI_MODEL = 'gemini-1.5-flash';
process.env.CLOUDFLARE_ACCOUNT_ID = 'test-cloudflare-account';
process.env.CLOUDFLARE_API_TOKEN = 'test-cloudflare-token';
process.env.CLOUDFLARE_MODEL = '@cf/google/gemma-4-26b-a4b-it';
process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'http://localhost:5173';
