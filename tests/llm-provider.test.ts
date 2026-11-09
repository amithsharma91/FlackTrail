import { describe, test, expect, vi, beforeEach } from 'vitest';
import { OpenRouterProvider } from '../backend/src/llm/providers/openrouter';
import { GeminiProvider } from '../backend/src/llm/providers/gemini';
import { CloudflareProvider } from '../backend/src/llm/providers/cloudflare';
import {
  AllProvidersFailedError,
  LLMOrchestrator,
} from '../backend/src/llm/orchestrator';
import {
  getAvailableProviders,
  getDefaultProvider,
  getProvider,
  getProviderOrder,
} from '../backend/src/llm/registry';
import { UsageTracker } from '../backend/src/usage';
import { redactSecrets } from '../backend/src/parser';

const mockFetch = vi.fn();

function mockResponse(
  status: number,
  body: unknown,
  statusText: string = 'OK'
): Response {
  return {
    status,
    statusText,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function mockFetchResponse(
  status: number,
  body: unknown,
  statusText: string = 'OK'
): void {
  mockFetch.mockResolvedValueOnce(mockResponse(status, body, statusText));
}

function openRouterResponse(content: string, model = 'openrouter/free') {
  return mockResponse(200, {
    id: 'chatcmpl-test',
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    model,
  });
}

function geminiResponse(content: string, model = 'gemini-1.5-flash') {
  return mockResponse(200, {
    candidates: [{ content: { parts: [{ text: content }] } }],
    usageMetadata: {
      promptTokenCount: 15,
      candidatesTokenCount: 25,
      totalTokenCount: 40,
    },
    modelVersion: model,
  });
}

function cloudflareResponse(content: string) {
  return mockResponse(200, {
    success: true,
    result: {
      response: content,
      usage: { input_tokens: 8, output_tokens: 15 },
      neurons: 42.82,
    },
  });
}

function makeOrchestrator(maxAttemptsPerProvider: number): LLMOrchestrator {
  return new LLMOrchestrator(new UsageTracker(), {
    maxAttemptsPerProvider,
    retryDelayMs: 0,
  });
}

const validAnalysis = {
  failureSummary: 'The payment gateway mock timed out.',
  possibleCauses: [
    {
      cause: 'Shared mock state is not reset between tests.',
      evidence: ['Timeout waiting for payment gateway mock'],
      confidence: 'high',
    },
  ],
  recommendedSteps: ['Reset the mock state between tests.'],
  confidence: 'high',
  uncertaintyExplanation: 'A verified memory supports this cause.',
};

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);

  process.env.OPENROUTER_API_KEY = 'sk-or-test-key-1234567890abcdef';
  process.env.OPENROUTER_MODEL = 'openrouter/free';
  process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

  process.env.GEMINI_API_KEY = 'AIza-test-key';
  process.env.GEMINI_MODEL = 'gemini-1.5-flash';
  process.env.GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

  process.env.CLOUDFLARE_ACCOUNT_ID = '24d4973f1cf52fe537962ec5cc3999a0';
  process.env.CLOUDFLARE_API_TOKEN = 'cfut-test-token-1234567890';
  process.env.CLOUDFLARE_MODEL = '@cf/google/gemma-4-26b-a4b-it';
});

describe('OpenRouter Provider', () => {
  test('successful inference returns normalized response', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-123',
      choices: [
        { message: { role: 'assistant', content: 'This is a test response' } },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'openrouter/free',
    });

    const provider = new OpenRouterProvider({
      model: 'openrouter/free',
      baseUrl: 'https://openrouter.ai/api/v1',
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

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toContain(
      'Bearer '
    );
  });

  test('throws on invalid API credentials (401)', async () => {
    mockFetchResponse(
      401,
      { error: { message: 'Incorrect API key' } },
      'Unauthorized'
    );

    const provider = new OpenRouterProvider({
      model: 'openrouter/free',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/401/);
  });

  test('throws on invalid model (404)', async () => {
    mockFetchResponse(
      404,
      { error: { message: 'Model not found' } },
      'Not Found'
    );

    const provider = new OpenRouterProvider({ model: 'invalid/model' });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/404/);
  });

  test('throws on timeout', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Request aborted'));

    const provider = new OpenRouterProvider({
      model: 'openrouter/free',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/request failed/i);
  });
});

describe('Gemini Provider', () => {
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
      modelVersion: 'gemini-1.5-flash',
    });

    const provider = new GeminiProvider({
      model: 'gemini-1.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    });

    const result = await provider.chat({
      messages: [
        { role: 'system', content: 'You are a CI analyst.' },
        { role: 'user', content: 'Hello' },
      ],
    });

    expect(result.content).toBe('Gemini response text');
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-1.5-flash');
    expect(result.usage?.inputTokens).toBe(15);
    expect(result.usage?.outputTokens).toBe(25);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/models/gemini-1.5-flash:generateContent');
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toBe('You are a CI analyst.');
  });

  test('throws on invalid API credentials (403)', async () => {
    mockFetchResponse(
      403,
      { error: { code: 403, message: 'API key not valid' } },
      'Forbidden'
    );

    const provider = new GeminiProvider({
      model: 'gemini-1.5-flash',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/403/);
  });
});

describe('Cloudflare Workers AI Provider', () => {
  test('successful inference returns normalized response', async () => {
    mockFetchResponse(200, {
      success: true,
      result: {
        response: 'Cloudflare Workers AI response',
        usage: { input_tokens: 8, output_tokens: 15 },
        neurons: 42.82,
      },
    });

    const provider = new CloudflareProvider({
      accountId: '24d4973f1cf52fe537962ec5cc3999a0',
      model: '@cf/google/gemma-4-26b-a4b-it',
    });

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.content).toBe('Cloudflare Workers AI response');
    expect(result.provider).toBe('cloudflare');
    expect(result.model).toBe('@cf/google/gemma-4-26b-a4b-it');
    expect(result.usage?.inputTokens).toBe(8);
    expect(result.usage?.outputTokens).toBe(15);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain(
      '/accounts/24d4973f1cf52fe537962ec5cc3999a0/ai/run/@cf/google/gemma-4-26b-a4b-it'
    );
  });

  test('throws on invalid credentials (403)', async () => {
    mockFetchResponse(
      403,
      {
        success: false,
        errors: [{ code: 10004, message: 'Authentication error' }],
      },
      'Forbidden'
    );

    const provider = new CloudflareProvider({
      accountId: 'bad-account',
      model: '@cf/google/gemma-4-26b-a4b-it',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/403/);
  });

  test('missing account ID is deferred to call time, not import time', async () => {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;

    const provider = new CloudflareProvider({
      model: '@cf/google/gemma-4-26b-a4b-it',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID is required/);

    process.env.CLOUDFLARE_ACCOUNT_ID = accountId;
  });
});

describe('Provider Registry', () => {
  test('exposes the current primary provider and fallback order', () => {
    expect(getDefaultProvider().provider).toBe('openrouter');
    expect(getProviderOrder()).toEqual([
      'openrouter',
      'gemini',
      'cloudflare',
    ]);
    expect(getAvailableProviders()).toEqual([
      'openrouter',
      'gemini',
      'cloudflare',
    ]);
  });

  test('getProvider returns the correct provider for each name', () => {
    expect(getProvider('openrouter')?.provider).toBe('openrouter');
    expect(getProvider('gemini')?.provider).toBe('gemini');
    expect(getProvider('cloudflare')?.provider).toBe('cloudflare');
    expect(getProvider('unknown')).toBeUndefined();
  });
});

describe('Unified Orchestrator', () => {
  test('generate uses the requested provider', async () => {
    mockFetch.mockResolvedValueOnce(
      openRouterResponse(JSON.stringify(validAnalysis))
    );

    const result = await makeOrchestrator(1).generate({
      messages: [{ role: 'user', content: 'Analyze this' }],
      options: { provider: 'openrouter' },
    });

    expect(result.provider).toBe('openrouter');
    expect(result.attempts).toBe(1);
    expect(result.fallbackUsed).toBe(false);
  });

  test('falls back to Gemini when OpenRouter fails', async () => {
    mockFetchResponse(503, { error: { message: 'upstream unavailable' } });
    mockFetch.mockResolvedValueOnce(
      geminiResponse(JSON.stringify(validAnalysis))
    );

    const result = await makeOrchestrator(1).generateWithFallback({
      messages: [{ role: 'user', content: 'Analyze this' }],
      options: { provider: 'openrouter' },
    });

    expect(result.provider).toBe('gemini');
    expect(result.attempts).toBe(2);
    expect(result.fallbackUsed).toBe(true);

    const urls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain('openrouter.ai');
    expect(urls[1]).toContain('generativelanguage.googleapis.com');
  });

  test('tries the full configured order when no provider is preferred', async () => {
    mockFetchResponse(503, { error: { message: 'openrouter down' } });
    mockFetchResponse(503, { error: { message: 'gemini down' } });
    mockFetchResponse(503, { error: { message: 'cloudflare down' } });

    await expect(
      makeOrchestrator(1).generateWithFallback({
        messages: [{ role: 'user', content: 'Analyze this' }],
      })
    ).rejects.toBeInstanceOf(AllProvidersFailedError);

    const urls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain('openrouter.ai');
    expect(urls[1]).toContain('generativelanguage.googleapis.com');
    expect(urls[2]).toContain('api.cloudflare.com');
  });

  test('does not retry authentication failures on the same provider', async () => {
    mockFetchResponse(
      401,
      { error: { message: 'Invalid OpenRouter key' } },
      'Unauthorized'
    );
    mockFetch.mockResolvedValueOnce(
      geminiResponse(JSON.stringify(validAnalysis))
    );

    const result = await makeOrchestrator(3).generateWithFallback({
      messages: [{ role: 'user', content: 'Analyze this' }],
      options: { provider: 'openrouter' },
    });

    expect(result.provider).toBe('gemini');
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const urls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain('openrouter.ai');
    expect(urls[1]).toContain('generativelanguage.googleapis.com');
  });

  test('retries rate limits on the same provider before falling back', async () => {
    mockFetchResponse(429, { error: { message: 'Rate limited' } });
    mockFetch.mockResolvedValueOnce(
      openRouterResponse(JSON.stringify(validAnalysis))
    );

    const result = await makeOrchestrator(2).generateWithFallback({
      messages: [{ role: 'user', content: 'Analyze this' }],
      options: { provider: 'openrouter' },
    });

    expect(result.provider).toBe('openrouter');
    expect(result.attempts).toBe(1);
    expect(result.fallbackUsed).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('falls back when a provider returns invalid structured output', async () => {
    mockFetch.mockResolvedValueOnce(openRouterResponse('not valid json'));
    mockFetch.mockResolvedValueOnce(
      geminiResponse(JSON.stringify(validAnalysis))
    );

    const validate = vi.fn((response) => {
      if (response.provider === 'openrouter') {
        throw new Error('malformed structured output');
      }
    });

    const result = await makeOrchestrator(1).generateWithFallback({
      messages: [{ role: 'user', content: 'Analyze this' }],
      options: { provider: 'openrouter' },
      validate,
    });

    expect(result.provider).toBe('gemini');
    expect(result.attempts).toBe(2);
    expect(validate).toHaveBeenCalledTimes(2);
  });

  test('reports validation-only failure when every provider returns bad output', async () => {
    mockFetch.mockResolvedValueOnce(openRouterResponse('bad openrouter json'));
    mockFetch.mockResolvedValueOnce(geminiResponse('bad gemini json'));
    mockFetch.mockResolvedValueOnce(cloudflareResponse('bad cloudflare json'));

    const validate = () => {
      throw new Error('malformed structured output');
    };

    try {
      await makeOrchestrator(1).generateWithFallback({
        messages: [{ role: 'user', content: 'Analyze this' }],
        validate,
      });
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(AllProvidersFailedError);
      const failure = err as AllProvidersFailedError;
      expect(failure.hasOnlyValidationFailures()).toBe(true);
      expect(failure.attempts.map((attempt) => attempt.provider)).toEqual([
        'openrouter',
        'gemini',
        'cloudflare',
      ]);
    }
  });

  test('rejects an unknown preferred provider', async () => {
    await expect(
      makeOrchestrator(1).generateWithFallback({
        messages: [{ role: 'user', content: 'Analyze this' }],
        options: { provider: 'not-a-provider' },
      })
    ).rejects.toThrow(/Unknown LLM provider/);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('Secret Redaction', () => {
  test('redacts API keys before sending to LLM providers', () => {
    const text = 'API key: sk-or-test-key-1234567890 and CI error';
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain('sk-or-test-key-1234567890');
    expect(redacted).toContain('[REDACTED_API_KEY]');
    expect(redacted).toContain('CI error');
  });
});
