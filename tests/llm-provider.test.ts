import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock fetch for all provider tests
const mockFetch = vi.fn();
vi.mock('node:fetch', () => ({
  default: mockFetch,
  __esModule: true,
}));

// Set env vars before importing provider modules that read them at module load
process.env.OPENROUTER_API_KEY = 'sk-or-test-key-1234567890abcdef';
process.env.OPENROUTER_MODEL = 'openrouter/free';
process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
process.env.GEMINI_API_KEY = 'AIza-test-key-1234567890';
process.env.GEMINI_MODEL = 'gemini-1.5-flash';
process.env.GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Import OpenRouter and Gemini classes (they don't read env vars at class construction)
import { OpenRouterProvider } from '../backend/src/llm/providers/openrouter';
import { GeminiProvider } from '../backend/src/llm/providers/gemini';
import { UsageTracker } from '../backend/src/usage';
import { LLMOrchestrator } from '../backend/src/llm/orchestrator';
import { LLMProviderRegistry } from '../backend/src/llm/registry';

// Helper to create a successful mock response
function mockFetchResponse(status: number, body: any, statusText: string = 'OK') {
  mockFetch.mockResolvedValueOnce({
    status,
    statusText,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response);
}

describe('OpenRouter Provider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  test('initializes with valid config', () => {
    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-test-key',
      model: 'openrouter/free',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
    expect(provider).toBeDefined();
    expect(provider.provider).toBe('openrouter');
  });

  test('successful inference returns normalized response', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-123',
      choices: [{ message: { role: 'assistant', content: 'This is a test response' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'openrouter/free',
    });

    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-test-key',
      model: 'openrouter/free',
    });

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.content).toBe('This is a test response');
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('openrouter/free');
    expect(result.usage?.inputTokens).toBe(10);
    expect(result.usage?.outputTokens).toBe(20);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('throws on invalid API credentials (401)', async () => {
    mockFetchResponse(401, { error: { message: 'Incorrect API key' } }, 'Unauthorized');

    const provider = new OpenRouterProvider({
      apiKey: 'invalid-key',
      model: 'openrouter/free',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/401/);
  });

  test('throws on invalid model (404)', async () => {
    mockFetchResponse(404, { error: { message: 'Model not found' } }, 'Not Found');

    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-test-key',
      model: 'invalid/model',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/404/);
  });

  test('throws on timeout', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Request aborted'));

    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-test-key',
      model: 'openrouter/free',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow();
  });
});

describe('Gemini Provider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  test('initializes with valid config', () => {
    const provider = new GeminiProvider({
      apiKey: 'AIza-test-key',
      model: 'gemini-1.5-flash',
    });
    expect(provider).toBeDefined();
    expect(provider.provider).toBe('gemini');
  });

  test('successful inference returns normalized response', async () => {
    mockFetchResponse(200, {
      candidates: [
        {
          content: { parts: [{ text: 'Gemini response text' }] },
        },
      ],
      usageMetadata: {
        promptTokenCount: 15,
        candidatesTokenCount: 25,
        totalTokenCount: 40,
      },
    });

    const provider = new GeminiProvider({
      apiKey: 'AIza-test-key',
      model: 'gemini-1.5-flash',
    });

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.content).toBe('Gemini response text');
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-1.5-flash');
    expect(result.usage?.inputTokens).toBe(15);
    expect(result.usage?.outputTokens).toBe(25);
  });

  test('throws on invalid API credentials (403)', async () => {
    mockFetchResponse(403, { error: { code: 403, message: 'API key not valid' } }, 'Forbidden');

    const provider = new GeminiProvider({
      apiKey: 'invalid-key',
      model: 'gemini-1.5-flash',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/403/);
  });
});

describe('Cloudflare Workers AI Provider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  test('initializes with valid config', async () => {
    // Set env vars before dynamic import (cloudflare.ts creates default instance at module load)
    process.env.CLOUDFLARE_ACCOUNT_ID = '24d4973f1cf52fe537962ec5cc3999a0';
    process.env.CLOUDFLARE_API_TOKEN = 'cfut-test-token-1234567890';
    process.env.CLOUDFLARE_MODEL = '@cf/google/gemma-4-26b-a4b-it';

    const { CloudflareProvider } = await import('../backend/src/llm/providers/cloudflare');
    const provider = new CloudflareProvider({
      accountId: '24d4973f1cf52fe537962ec5cc3999a0',
      apiToken: 'cfut-test-token',
      model: '@cf/google/gemma-4-26b-a4b-it',
    });
    expect(provider).toBeDefined();
    expect(provider.provider).toBe('cloudflare');
  });

  test('successful inference returns normalized response', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = '24d4973f1cf52fe537962ec5cc3999a0';
    process.env.CLOUDFLARE_API_TOKEN = 'cfut-test-token-1234567890';
    process.env.CLOUDFLARE_MODEL = '@cf/google/gemma-4-26b-a4b-it';

    const { CloudflareProvider } = await import('../backend/src/llm/providers/cloudflare');
    const provider = new CloudflareProvider({
      accountId: '24d4973f1cf52fe537962ec5cc3999a0',
      apiToken: 'cfut-test-token',
      model: '@cf/google/gemma-4-26b-a4b-it',
    });

    mockFetchResponse(200, {
      success: true,
      result: {
        response: 'Cloudflare Workers AI response',
        usage: { input_tokens: 8, output_tokens: 15 },
        neurons: 42.82,
      },
    });

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.content).toBe('Cloudflare Workers AI response');
    expect(result.provider).toBe('cloudflare');
    expect(result.model).toBe('@cf/google/gemma-4-26b-a4b-it');
    expect(result.usage?.inputTokens).toBe(8);
    expect(result.usage?.outputTokens).toBe(15);
  });

  test('throws on invalid credentials (403)', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = '24d4973f1cf52fe537962ec5cc3999a0';
    process.env.CLOUDFLARE_API_TOKEN = 'cfut-test-token-1234567890';
    process.env.CLOUDFLARE_MODEL = '@cf/google/gemma-4-26b-a4b-it';

    const { CloudflareProvider } = await import('../backend/src/llm/providers/cloudflare');
    const provider = new CloudflareProvider({
      accountId: 'bad-account',
      apiToken: 'bad-token',
      model: '@cf/google/gemma-4-26b-a4b-it',
    });

    mockFetchResponse(403, { success: false, errors: [{ code: 10004, message: 'Authentication error' }] }, 'Forbidden');

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/403/);
  });
});

describe('Provider Registry', () => {
  test('getProvider returns correct provider for each name', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = '24d4973f1cf52fe537962ec5cc3999a0';
    process.env.CLOUDFLARE_API_TOKEN = 'cfut-test-token-1234567890';
    process.env.CLOUDFLARE_MODEL = '@cf/google/gemma-4-26b-a4b-it';

    const { getProvider } = await import('../backend/src/llm/registry');

    expect(getProvider('openrouter')).toBeDefined();
    expect(getProvider('gemini')).toBeDefined();
    expect(getProvider('cloudflare')).toBeDefined();
    expect(getProvider('unknown')).toBeUndefined();
  });

  test('getAvailableProviders returns all three providers', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = '24d4973f1cf52fe537962ec5cc3999a0';
    process.env.CLOUDFLARE_API_TOKEN = 'cfut-test-token-1234567890';
    process.env.CLOUDFLARE_MODEL = '@cf/google/gemma-4-26b-a4b-it';

    const { getAvailableProviders } = await import('../backend/src/llm/registry');
    const providers = getAvailableProviders();
    expect(providers).toContain('openrouter');
    expect(providers).toContain('gemini');
    expect(providers).toContain('cloudflare');
  });
});

describe('Unified Orchestrator', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  test('orchestrates through OpenRouter provider', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-123',
      choices: [{ message: { role: 'assistant', content: 'Orchestrated response' } }],
      usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      model: 'openrouter/free',
    });

    const { LLMOrchestrator } = await import('../backend/src/llm/orchestrator');
    const tracker = new UsageTracker();
    const orchestrator = new LLMOrchestrator(tracker);
    const result = await orchestrator.generate([
      { role: 'user', content: 'Test prompt' },
    ], { provider: 'openrouter' });

    expect(result.content).toBe('Orchestrated response');
    expect(result.provider).toBe('openrouter');
  });

  test('fallback provider triggers on failure', async () => {
    // First call fails (OpenRouter)
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    // Second call succeeds (Gemini fallback)
    mockFetchResponse(200, {
      candidates: [{ content: { parts: [{ text: 'Fallback response' }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 15 },
    });

    const { LLMOrchestrator } = await import('../backend/src/llm/orchestrator');
    const tracker = new UsageTracker();
    const orchestrator = new LLMOrchestrator(tracker);
    const result = await orchestrator.generateWithFallback({
      messages: [{ role: 'user', content: 'Test prompt' }],
    }, { provider: 'openrouter' });

    expect(result.content).toBe('Fallback response');
    expect(result.provider).toBe('gemini');
  });

  test('fallback is disabled when not configured', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { LLMOrchestrator } = await import('../backend/src/llm/orchestrator');
    const tracker = new UsageTracker();
    const orchestrator = new LLMOrchestrator(tracker);
    await expect(
      orchestrator.generateWithFallback([{ role: 'user', content: 'Test prompt' }], { provider: 'openrouter' })
    ).rejects.toThrow();
  });
});

describe('Secret Redaction', () => {
  test('redacts API keys before sending to LLM providers', async () => {
    const { redactSecrets } = await import('../backend/src/parser');
    const text = 'API key: sk-or-test-key-1234567890 and CI error';
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain('sk-or-test-key-1234567890');
    expect(redacted).toContain('[REDACTED_API_KEY]');
    expect(redacted).toContain('CI error');
  });
});

describe('Reasoning Compatibility', () => {
  test('existing reasoning module still works without LLM', async () => {
    const { analyzeFailure } = await import('../backend/src/reasoning');
    const result = await analyzeFailure({
      parsedFailure: {
        testName: 'test_payment_retry',
        errorMessage: 'timeout after 30s',
        failureSignature: 'sig-123',
      },
      historicalInvestigations: [],
    });

    expect(result.failureSummary).toContain('test_payment_retry');
    expect(result.recommendedSteps.length).toBeGreaterThan(0);
    expect(result.confidence).toBe('low');
  });
});
