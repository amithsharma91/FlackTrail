// Test environment setup for FlakeTrail QA suite.
// Sets deterministic environment variables before backend modules load so that
// dotenv.config() (in backend/src/config/env) does not override them and no
// real Hindsight / LLM credentials are required. All external calls are mocked.
process.env.HINDSIGHT_API_KEY = 'test-hindsight-key';
process.env.HINDSIGHT_BANK_ID = 'flaketrail-ci-memory';
process.env.HINDSIGHT_API_URL = 'https://api.hindsight.vectorize.io';
process.env.LLM_API_KEY = 'sk-test-llm-key';
process.env.LLM_PROVIDER = 'openai';
process.env.LLM_MODEL = 'gpt-4o-mini';
process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'http://localhost:5173';
