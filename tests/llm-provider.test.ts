import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { analyzeFailureDetailed, setAnalysisOrchestrator } from '../backend/src/reasoning';
import { LLMAnalysisSchema } from '../backend/src/shared/schemas';
import type {
  LLMMessage,
  OrchestratorRequest,
  OrchestratorResponse,
} from '../backend/src/llm/types';

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

function openRouterResponse(content: string, model = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free') {
  return mockResponse(200, {
    id: 'chatcmpl-test',
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    model,
  });
}

function geminiResponse(content: string, model = 'gemini-3.6-flash') {
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
  process.env.OPENROUTER_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';
  process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

  process.env.GEMINI_API_KEY = 'AIza-test-key';
  process.env.GEMINI_MODEL = 'gemini-3.6-flash';
  process.env.GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

  process.env.CLOUDFLARE_ACCOUNT_ID = '24d4973f1cf52fe537962ec5cc3999a0';
  process.env.CLOUDFLARE_API_TOKEN = 'cfut-test-token-1234567890';
  process.env.CLOUDFLARE_MODEL = '@cf/zai-org/glm-4.7-flash';
});

afterEach(() => {
  setAnalysisOrchestrator(null);
});

describe('OpenRouter Provider', () => {
  test('successful inference returns normalized response', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-123',
      choices: [{ message: { role: 'assistant', content: 'This is a test response' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'meta-llama/llama-3.1-8b-instruct:free',
    });

    const provider = new OpenRouterProvider({
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      baseUrl: 'https://openrouter.ai/api/v1',
    });

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.content).toBe('This is a test response');
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('meta-llama/llama-3.1-8b-instruct:free');
    expect(result.usage?.inputTokens).toBe(10);
    expect(result.usage?.outputTokens).toBe(20);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toContain('Bearer ');
  });

  test('throws on invalid API credentials (401)', async () => {
    mockFetchResponse(401, { error: { message: 'Incorrect API key' } }, 'Unauthorized');

    const provider = new OpenRouterProvider({
      model: 'meta-llama/llama-3.1-8b-instruct:free',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/401/);
  });

  test('throws on invalid model (404)', async () => {
    mockFetchResponse(404, { error: { message: 'Model not found' } }, 'Not Found');

    const provider = new OpenRouterProvider({ model: 'invalid/model' });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/404/);
  });

  test('throws on timeout', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Request aborted'));

    const provider = new OpenRouterProvider({
      model: 'meta-llama/llama-3.1-8b-instruct:free',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/request failed/i);
  });

  test('throws on empty content from reasoning model', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-empty',
      choices: [
        {
          message: { role: 'assistant', content: '' },
          finish_reason: 'length',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      model: 'meta-llama/llama-3.1-8b-instruct:free',
    });

    const provider = new OpenRouterProvider({
      model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/empty analysis response/);
  });

  test('throws on whitespace-only content', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-ws',
      choices: [
        {
          message: { role: 'assistant', content: '   \n\t  ' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
      model: 'meta-llama/llama-3.1-8b-instruct:free',
    });

    const provider = new OpenRouterProvider();

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/empty analysis response/);
  });

  test('throws on malformed JSON from reasoning model', async () => {
    // Reasoning models may interleave thinking traces with partial JSON,
    // producing content that is not valid JSON.
    mockFetchResponse(200, {
      id: 'chatcmpl-malformed',
      choices: [
        {
          message: {
            role: 'assistant',
            content:
              'Thinking about the failure...\n{"failureSummary":"partial","possibleCauses":',
          },
          finish_reason: 'length',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
      model: 'meta-llama/llama-3.1-8b-instruct:free',
    });

    const provider = new OpenRouterProvider({
      model: 'meta-llama/llama-3.1-8b-instruct:free',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).resolves.toHaveProperty('content');
  });

  test('uses new default instruct model when no model specified', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-default',
      choices: [{ message: { role: 'assistant', content: 'default model response' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'meta-llama/llama-3.1-8b-instruct:free',
    });

    const provider = new OpenRouterProvider();
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.model).toBe('meta-llama/llama-3.1-8b-instruct:free');
    expect(result.content).toBe('default model response');
  });
});

describe('Gemini Provider', () => {
  test('successful inference returns normalized response', async () => {
    mockFetchResponse(200, {
      candidates: [{ content: { parts: [{ text: 'Gemini response text' }] } }],
      usageMetadata: {
        promptTokenCount: 15,
        candidatesTokenCount: 25,
        totalTokenCount: 40,
      },
      modelVersion: 'gemini-3.6-flash',
    });

    const provider = new GeminiProvider({
      model: 'gemini-3.6-flash',
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
    expect(result.model).toBe('gemini-3.6-flash');
    expect(result.usage?.inputTokens).toBe(15);
    expect(result.usage?.outputTokens).toBe(25);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/models/gemini-3.6-flash:generateContent');
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toBe('You are a CI analyst.');
  });

  test('throws on invalid API credentials (403)', async () => {
    mockFetchResponse(
      403,
      { error: { code: 403, message: 'API key not valid' } },
      'Forbidden'
    );

    const provider = new GeminiProvider({ model: 'gemini-3.6-flash' });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/403/);
  });

  test('throws on empty content (thinking-only response)', async () => {
    mockFetchResponse(200, {
      candidates: [
        {
          content: {
            parts: [{ thought: true }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 0,
        totalTokenCount: 10,
      },
      modelVersion: 'gemini-3.6-flash',
    });

    const provider = new GeminiProvider({ model: 'gemini-3.6-flash' });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/empty analysis response/);
  });

  test('throws on truncated response (MAX_TOKENS)', async () => {
    mockFetchResponse(200, {
      candidates: [
        {
          content: {
            parts: [{ text: '{"failureSummary":"incomplete' }],
          },
          finishReason: 'MAX_TOKENS',
        },
      ],
      usageMetadata: {
        promptTokenCount: 15,
        candidatesTokenCount: 100,
        totalTokenCount: 115,
      },
      modelVersion: 'gemini-3.6-flash',
    });

    const provider = new GeminiProvider({ model: 'gemini-3.6-flash' });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/truncated/);
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
      model: '@cf/meta/llama-3.1-8b-instruct',
    });

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.content).toBe('Cloudflare Workers AI response');
    expect(result.provider).toBe('cloudflare');
    expect(result.model).toBe('@cf/meta/llama-3.1-8b-instruct');
    expect(result.usage?.inputTokens).toBe(8);
    expect(result.usage?.outputTokens).toBe(15);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain(
      '/accounts/24d4973f1cf52fe537962ec5cc3999a0/ai/run/@cf/meta/llama-3.1-8b-instruct'
    );
  });

  test('throws on invalid credentials (403)', async () => {
    mockFetchResponse(
      403,
      { success: false, errors: [{ code: 10004, message: 'Authentication error' }] },
      'Forbidden'
    );

    const provider = new CloudflareProvider({
      accountId: 'bad-account',
      model: '@cf/meta/llama-3.1-8b-instruct',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/403/);
  });

  test('missing account ID is deferred to call time, not import time', async () => {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;

    const provider = new CloudflareProvider({ model: '@cf/meta/llama-3.1-8b-instruct' });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID is required/);

    process.env.CLOUDFLARE_ACCOUNT_ID = accountId;
  });

  test('throws on authentication error (401)', async () => {
    mockFetchResponse(
      401,
      { success: false, errors: [{ code: 10000, message: 'Authentication error' }] },
      'Unauthorized'
    );

    const provider = new CloudflareProvider({
      accountId: '24d4973f1cf52fe537962ec5cc3999a0',
      model: '@cf/zai-org/glm-4.7-flash',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/401/);
  });

  test('throws on success:false with HTTP 200', async () => {
    mockFetchResponse(200, {
      success: false,
      errors: [{ code: 10005, message: 'Model not found' }],
      messages: [],
    });

    const provider = new CloudflareProvider({
      accountId: '24d4973f1cf52fe537962ec5cc3999a0',
      model: '@cf/zai-org/glm-4.7-flash',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/Model not found/);
  });

  test('throws on empty content', async () => {
    mockFetchResponse(200, {
      success: true,
      result: {
        response: '',
        usage: { input_tokens: 8, output_tokens: 0 },
        neurons: 0,
      },
    });

    const provider = new CloudflareProvider({
      accountId: '24d4973f1cf52fe537962ec5cc3999a0',
      model: '@cf/zai-org/glm-4.7-flash',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/empty analysis response/);
  });
});

describe('Provider Registry', () => {
  test('exposes the current primary provider and fallback order', () => {
    expect(getDefaultProvider().provider).toBe('openrouter');
    expect(getProviderOrder()).toEqual(['openrouter', 'gemini', 'cloudflare']);
    expect(getAvailableProviders()).toEqual(['openrouter', 'gemini', 'cloudflare']);
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
    mockFetch.mockResolvedValueOnce(openRouterResponse(JSON.stringify(validAnalysis)));

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
    mockFetch.mockResolvedValueOnce(geminiResponse(JSON.stringify(validAnalysis)));

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
    mockFetchResponse(401, { error: { message: 'Invalid OpenRouter key' } }, 'Unauthorized');
    mockFetch.mockResolvedValueOnce(geminiResponse(JSON.stringify(validAnalysis)));

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
    mockFetch.mockResolvedValueOnce(openRouterResponse(JSON.stringify(validAnalysis)));

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
    mockFetch.mockResolvedValueOnce(geminiResponse(JSON.stringify(validAnalysis)));

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

  test('falls back when OpenRouter returns empty content (reasoning model)', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        id: 'chatcmpl-empty',
        choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      })
    );
    mockFetch.mockResolvedValueOnce(geminiResponse(JSON.stringify(validAnalysis)));

    const result = await makeOrchestrator(1).generateWithFallback({
      messages: [{ role: 'user', content: 'Analyze this' }],
      options: { provider: 'openrouter' },
      validate: (response) => {
        const validated = LLMAnalysisSchema.safeParse(JSON.parse(response.content));
        if (!validated.success) throw new Error('invalid schema');
      },
    });

    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-3.6-flash');
    expect(result.fallbackUsed).toBe(true);
    expect(result.attempts).toBe(2);
  });

  test('falls back when Gemini returns truncated response (MAX_TOKENS)', async () => {
    // OpenRouter fails first (empty content), then Gemini truncated, then Cloudflare succeeds.
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        id: 'chatcmpl-empty',
        choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      })
    );
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: '{"failureSummary":"truncated' }] },
            finishReason: 'MAX_TOKENS',
          },
        ],
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 100, totalTokenCount: 115 },
        modelVersion: 'gemini-3.6-flash',
      })
    );
    mockFetch.mockResolvedValueOnce(cloudflareResponse(JSON.stringify(validAnalysis)));

    const result = await makeOrchestrator(1).generateWithFallback({
      messages: [{ role: 'user', content: 'Analyze this' }],
      validate: (response) => {
        const validated = LLMAnalysisSchema.safeParse(JSON.parse(response.content));
        if (!validated.success) throw new Error('invalid schema');
      },
    });

    expect(result.provider).toBe('cloudflare');
    expect(result.model).toBe('@cf/zai-org/glm-4.7-flash');
    expect(result.fallbackUsed).toBe(true);
    expect(result.attempts).toBe(3);
  });

  test('falls back when Cloudflare returns 401 authentication error', async () => {
    // Provider order with cloudflare preferred: cloudflare → openrouter → gemini
    mockFetch.mockResolvedValueOnce(
      mockResponse(401, {
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
      }, 'Unauthorized')
    );
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        id: 'chatcmpl-empty',
        choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      })
    );
    mockFetch.mockResolvedValueOnce(geminiResponse(JSON.stringify(validAnalysis)));

    const result = await makeOrchestrator(1).generateWithFallback({
      messages: [{ role: 'user', content: 'Analyze this' }],
      options: { provider: 'cloudflare' },
      validate: (response) => {
        const validated = LLMAnalysisSchema.safeParse(JSON.parse(response.content));
        if (!validated.success) throw new Error('invalid schema');
      },
    });

    expect(result.provider).toBe('gemini');
    expect(result.fallbackUsed).toBe(true);
  });

  test('all providers fail: empty content + truncated JSON + 401 auth error', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        id: 'chatcmpl-empty',
        choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      })
    );
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, {
        candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, totalTokenCount: 10 },
        modelVersion: 'gemini-3.6-flash',
      })
    );
    mockFetch.mockResolvedValueOnce(
      mockResponse(401, {
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
      }, 'Unauthorized')
    );

    try {
      await makeOrchestrator(1).generateWithFallback({
        messages: [{ role: 'user', content: 'Analyze this' }],
        validate: (response) => {
          const validated = LLMAnalysisSchema.safeParse(JSON.parse(response.content));
          if (!validated.success) throw new Error('invalid schema');
        },
      });
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(AllProvidersFailedError);
      const failure = err as AllProvidersFailedError;
      expect(failure.attempts.map((a) => a.provider)).toEqual([
        'openrouter',
        'gemini',
        'cloudflare',
      ]);
      // OpenRouter and Gemini are validation failures; Cloudflare is transport (401)
      expect(failure.hasOnlyValidationFailures()).toBe(false);
      const cfAttempt = failure.attempts.find((a) => a.provider === 'cloudflare');
      expect(cfAttempt?.statusCode).toBe(401);
      expect(cfAttempt?.kind).toBe('transport');
    }
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

describe('LLM analysis parsing', () => {
  function installFakeOrchestrator(
    content: string,
    overrides: Partial<OrchestratorResponse> = {}
  ): ReturnType<typeof vi.fn> {
    const generateWithFallback = vi.fn(async (): Promise<OrchestratorResponse> => ({
      content,
      provider: 'test-provider',
      model: 'test-model',
      latencyMs: 0,
      attempts: 1,
      fallbackUsed: false,
      ...overrides,
    }));
    setAnalysisOrchestrator({ generateWithFallback });
    return generateWithFallback;
  }

  test('empty response throws AIAnalysisFormatError', async () => {
    installFakeOrchestrator('');

    await expect(
      analyzeFailureDetailed({
        parsedFailure: { testName: 'test_payment_retry', errorMessage: 'timeout after 30s', failureSignature: 'sig-123' },
        historicalInvestigations: [],
      })
    ).rejects.toThrow(/LLM returned an empty analysis response/);
  });

  test('invalid JSON throws AIAnalysisFormatError', async () => {
    installFakeOrchestrator('{invalid json}');

    await expect(
      analyzeFailureDetailed({
        parsedFailure: { testName: 'test_payment_retry', errorMessage: 'timeout after 30s', failureSignature: 'sig-123' },
        historicalInvestigations: [],
      })
    ).rejects.toThrow(/LLM response contained malformed JSON/);
  });

  test('markdown-wrapped JSON parses correctly', async () => {
    installFakeOrchestrator(`\`\`\`json\n${JSON.stringify(validAnalysis)}\n\`\`\`\n`);

    const result = await analyzeFailureDetailed({
      parsedFailure: { testName: 'test_payment_retry', errorMessage: 'timeout after 30s', failureSignature: 'sig-123' },
      historicalInvestigations: [],
    });

    expect(result.analysis.failureSummary).toBe(validAnalysis.failureSummary);
    expect(result.analysis.possibleCauses).toHaveLength(1);
    expect(result.analysis.possibleCauses[0].cause).toBe('Shared mock state is not reset between tests.');
    expect(result.diagnostics.provider).toBe('test-provider');
  });

  test('valid JSON parses correctly without markdown fences', async () => {
    installFakeOrchestrator(JSON.stringify(validAnalysis));

    const result = await analyzeFailureDetailed({
      parsedFailure: { testName: 'test_payment_retry', errorMessage: 'timeout after 30s', failureSignature: 'sig-123' },
      historicalInvestigations: [],
    });

    expect(result.analysis.failureSummary).toBe(validAnalysis.failureSummary);
    expect(result.analysis.possibleCauses).toHaveLength(1);
    expect(result.analysis.possibleCauses[0].cause).toBe('Shared mock state is not reset between tests.');
  });

  test('provider failure triggers fallback to next provider', async () => {
    const generateWithFallback = vi.fn(async (request: OrchestratorRequest) => {
      const first: OrchestratorResponse = {
        content: 'invalid json',
        provider: 'openrouter',
        model: 'openrouter/free',
        attempts: 1,
        fallbackUsed: false,
        latencyMs: 0,
      };
      if (request.validate) {
        try {
          request.validate(first);
        } catch {
          // Validation failed on the first provider; fall back to the next.
          const second: OrchestratorResponse = {
            content: JSON.stringify(validAnalysis),
            provider: 'gemini',
            model: 'gemini-3.6-flash',
            attempts: 2,
            fallbackUsed: true,
            latencyMs: 0,
          };
          if (request.validate) {
            await request.validate(second);
          }
          return second;
        }
      }
      return first;
    });

    setAnalysisOrchestrator({ generateWithFallback });

    const result = await analyzeFailureDetailed({
      parsedFailure: { testName: 'test_payment_retry', errorMessage: 'timeout after 30s', failureSignature: 'sig-123' },
      historicalInvestigations: [],
    });

    expect(result.analysis.failureSummary).toBe(validAnalysis.failureSummary);
    expect(result.diagnostics.provider).toBe('gemini');
    expect(result.diagnostics.fallbackUsed).toBe(true);
  });
});

describe('Provider model configuration regression', () => {
  const analysisJson = JSON.stringify(validAnalysis);

  test('OpenRouter extracts content from choices[].message.content with correct model', async () => {
    mockFetch.mockResolvedValueOnce(openRouterResponse(analysisJson));

    const provider = new OpenRouterProvider({
      model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    });
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Analyze this' }],
    });

    expect(result.content).toBe(analysisJson);
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');
  });

  test('Gemini extracts content from candidates[].content.parts[].text with correct model', async () => {
    mockFetch.mockResolvedValueOnce(geminiResponse(analysisJson));

    const provider = new GeminiProvider({
      model: 'gemini-3.6-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    });
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Analyze this' }],
    });

    expect(result.content).toBe(analysisJson);
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-3.6-flash');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/models/gemini-3.6-flash:generateContent');
  });

  test('Cloudflare extracts content from result.response with correct model', async () => {
    mockFetch.mockResolvedValueOnce(cloudflareResponse(analysisJson));

    const provider = new CloudflareProvider({
      accountId: '24d4973f1cf52fe537962ec5cc3999a0',
      model: '@cf/zai-org/glm-4.7-flash',
    });
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Analyze this' }],
    });

    expect(result.content).toBe(analysisJson);
    expect(result.provider).toBe('cloudflare');
    expect(result.model).toBe('@cf/zai-org/glm-4.7-flash');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain(
      '/accounts/24d4973f1cf52fe537962ec5cc3999a0/ai/run/@cf/zai-org/glm-4.7-flash'
    );
  });

  test('OpenRouter response passes strict LLMAnalysisSchema validation', async () => {
    mockFetch.mockResolvedValueOnce(openRouterResponse(analysisJson));

    const provider = new OpenRouterProvider({
      model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    });
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Analyze this' }],
    });

    const { LLMAnalysisSchema } = await import('../backend/src/shared/schemas');
    const validated = LLMAnalysisSchema.safeParse(JSON.parse(result.content));
    expect(validated.success).toBe(true);
    if (validated.success) {
      expect(validated.data.failureSummary).toBe(validAnalysis.failureSummary);
      expect(validated.data.confidence).toBe('high');
    }
  });

  test('Gemini response passes strict LLMAnalysisSchema validation', async () => {
    mockFetch.mockResolvedValueOnce(geminiResponse(analysisJson));

    const provider = new GeminiProvider({
      model: 'gemini-3.6-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    });
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Analyze this' }],
    });

    const { LLMAnalysisSchema } = await import('../backend/src/shared/schemas');
    const validated = LLMAnalysisSchema.safeParse(JSON.parse(result.content));
    expect(validated.success).toBe(true);
    if (validated.success) {
      expect(validated.data.failureSummary).toBe(validAnalysis.failureSummary);
    }
  });

  test('Cloudflare response passes strict LLMAnalysisSchema validation', async () => {
    mockFetch.mockResolvedValueOnce(cloudflareResponse(analysisJson));

    const provider = new CloudflareProvider({
      accountId: '24d4973f1cf52fe537962ec5cc3999a0',
      model: '@cf/zai-org/glm-4.7-flash',
    });
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Analyze this' }],
    });

    const { LLMAnalysisSchema } = await import('../backend/src/shared/schemas');
    const validated = LLMAnalysisSchema.safeParse(JSON.parse(result.content));
    expect(validated.success).toBe(true);
    if (validated.success) {
      expect(validated.data.failureSummary).toBe(validAnalysis.failureSummary);
    }
  });

  test('failover: OpenRouter invalid JSON falls back to Gemini schema-valid output', async () => {
    mockFetch.mockResolvedValueOnce(openRouterResponse('not valid json'));
    mockFetch.mockResolvedValueOnce(geminiResponse(analysisJson));

    const result = await makeOrchestrator(1).generateWithFallback({
      messages: [{ role: 'user', content: 'Analyze this' }],
      options: { provider: 'openrouter' },
      validate: (response) => {
        const validated = LLMAnalysisSchema.safeParse(JSON.parse(response.content));
        if (!validated.success) throw new Error('invalid schema');
      },
    });

    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-3.6-flash');
    expect(result.fallbackUsed).toBe(true);
    expect(result.attempts).toBe(2);
  });

  test('failover: Gemini invalid JSON falls back to Cloudflare schema-valid output', async () => {
    mockFetch.mockResolvedValueOnce(openRouterResponse('not valid json'));
    mockFetch.mockResolvedValueOnce(geminiResponse('bad json'));
    mockFetch.mockResolvedValueOnce(cloudflareResponse(analysisJson));

    const result = await makeOrchestrator(1).generateWithFallback({
      messages: [{ role: 'user', content: 'Analyze this' }],
      validate: (response) => {
        const validated = LLMAnalysisSchema.safeParse(JSON.parse(response.content));
        if (!validated.success) throw new Error('invalid schema');
      },
    });

    expect(result.provider).toBe('cloudflare');
    expect(result.model).toBe('@cf/zai-org/glm-4.7-flash');
    expect(result.fallbackUsed).toBe(true);
    expect(result.attempts).toBe(3);
  });
});
