// Test environment setup for FlakeTrail QA suite.
// Sets deterministic environment variables before backend modules load so that
// dotenv.config() (in backend/src/config/env) does not override them and no
// real Hindsight / LLM credentials are required. All external calls are mocked.
process.env.HINDSIGHT_API_KEY = 'test-hindsight-key';
process.env.HINDSIGHT_BANK_ID = 'flaketrail-ci-memory';
process.env.HINDSIGHT_API_URL = 'https://api.hindsight.vectorize.io';
process.env.STRICT_FREE_MODE = 'true';

// OpenRouter
process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.OPENROUTER_MODEL = 'meta-llama/llama-3.1-8b-instruct:free';
process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
process.env.OPENROUTER_ENABLED = 'true';

// Gemini
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.GEMINI_MODEL = 'gemini-3.6-flash';
process.env.GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
process.env.GEMINI_ENABLED = 'true';

// Cloudflare
process.env.CLOUDFLARE_ACCOUNT_ID = 'test-cloudflare-account';
process.env.CLOUDFLARE_API_TOKEN = 'test-cloudflare-token';
process.env.CLOUDFLARE_MODEL = '@cf/zai-org/glm-4.7-flash';
process.env.CLOUDFLARE_ENABLED = 'true';

// Groq
process.env.GROQ_API_KEY = 'test-groq-key';
process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
process.env.GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
process.env.GROQ_ENABLED = 'true';

// NVIDIA NIM
process.env.NVIDIA_API_KEY = 'test-nvidia-key';
process.env.NVIDIA_MODEL = 'meta/llama-3.1-8b-instruct';
process.env.NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
process.env.NVIDIA_ENABLED = 'true';

// Z.AI / GLM
process.env.ZAI_API_KEY = 'test-zai-key';
process.env.ZAI_MODEL = 'glm-4.5';
process.env.ZAI_BASE_URL = 'https://api.z.ai/api/paas/v4';
process.env.ZAI_ENABLED = 'true';

// Mistral (disabled by default)
process.env.MISTRAL_API_KEY = 'test-mistral-key';
process.env.MISTRAL_MODEL = 'mistral-small-latest';
process.env.MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';
process.env.MISTRAL_ENABLED = 'false';

// SambaNova (disabled by default)
process.env.SAMBANOVA_API_KEY = 'test-sambanova-key';
process.env.SAMBANOVA_MODEL = 'Llama-4-Maverick-17B-128E-Instruct';
process.env.SAMBANOVA_BASE_URL = 'https://api.sambanova.ai/v1';
process.env.SAMBANOVA_ENABLED = 'false';

process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'http://localhost:5173';
