import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZAIProvider } from '../backend/src/llm/providers/zai';
import { LLMAnalysisSchema } from '../backend/src/shared/schemas';

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

  process.env.ZAI_API_KEY = 'test-zai-key';
  process.env.ZAI_MODEL = 'glm-4.5';
  process.env.ZAI_BASE_URL = 'https://api.z.ai/api/paas/v4';
  process.env.ZAI_ENABLED = 'true';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Z.AI Provider - Configuration', () => {
  test('loads configuration from environment variables', () => {
    const provider = new ZAIProvider({
      model: 'custom-model',
      baseUrl: 'https://custom.zai.url/v1',
    });
    expect(provider).toBeInstanceOf(ZAIProvider);
    expect(provider.provider).toBe('zai');
  });

  test('uses default model when not specified', () => {
    const provider = new ZAIProvider();
    expect(provider).toBeInstanceOf(ZAIProvider);
  });

  test('is disabled when ZAI_ENABLED=false', async () => {
    const origEnabled = process.env.ZAI_ENABLED;
    process.env.ZAI_ENABLED = 'false';
    const provider = new ZAIProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/disabled/);
    process.env.ZAI_ENABLED = origEnabled;
  });
});

describe('Z.AI Provider - Request Construction', () => {
  test('sends request to correct URL with auth header', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-test',
      choices: [{ message: { role: 'assistant', content: 'Hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'glm-4.5',
    });

    const provider = new ZAIProvider();
    await provider.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.z.ai/api/paas/v4/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-zai-key'
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json'
    );
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('glm-4.5');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(body.stream).toBe(false);
  });

  test('includes system messages in request body', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-test',
      choices: [{ message: { role: 'assistant', content: 'Hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'glm-4.5',
    });

    const provider = new ZAIProvider();
    await provider.chat({
      messages: [
        { role: 'system', content: 'You are a CI analyst.' },
        { role: 'user', content: 'Hello' },
      ],
    });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(String(init.body));
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a CI analyst.' },
      { role: 'user', content: 'Hello' },
    ]);
  });
});

describe('Z.AI Provider - Successful Response Parsing', () => {
  test('returns normalized response with content, provider, model, usage', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-123',
      choices: [{ message: { role: 'assistant', content: 'Analysis result' } }],
      usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
      model: 'glm-4.5',
    });

    const provider = new ZAIProvider();
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Analyze this' }],
    });

    expect(result.content).toBe('Analysis result');
    expect(result.provider).toBe('zai');
    expect(result.model).toBe('glm-4.5');
    expect(result.usage?.inputTokens).toBe(15);
    expect(result.usage?.outputTokens).toBe(25);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('response passes strict LLMAnalysisSchema validation', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-test',
      choices: [{ message: { role: 'assistant', content: JSON.stringify(validAnalysis) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'glm-4.5',
    });

    const provider = new ZAIProvider();
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Analyze this' }],
    });

    const validated = LLMAnalysisSchema.safeParse(JSON.parse(result.content));
    expect(validated.success).toBe(true);
    if (validated.success) {
      expect(validated.data.failureSummary).toBe(validAnalysis.failureSummary);
    }
  });
});

describe('Z.AI Provider - Error Handling', () => {
  test('throws on empty response', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-empty',
      choices: [{ message: { role: 'assistant', content: '' } }],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      model: 'glm-4.5',
    });

    const provider = new ZAIProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/empty analysis response/);
  });

  test('throws on malformed JSON', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-malformed',
      choices: [{ message: { role: 'assistant', content: '{invalid json' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: 'glm-4.5',
    });

    const provider = new ZAIProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).resolves.toHaveProperty('content');
  });

  test('throws on 401 authentication error', async () => {
    mockFetchResponse(
      401,
      { error: { message: 'Incorrect API key', code: 401 } },
      'Unauthorized'
    );

    const provider = new ZAIProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/401/);
  });

  test('throws on 403 permission error', async () => {
    mockFetchResponse(
      403,
      { error: { message: 'Insufficient permissions', code: 403 } },
      'Forbidden'
    );

    const provider = new ZAIProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/403/);
  });

  test('throws on 429 rate limit', async () => {
    mockFetchResponse(
      429,
      { error: { message: 'Rate limit exceeded', code: 429 } },
      'Too Many Requests'
    );

    const provider = new ZAIProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/429/);
  });

  test('throws on 5xx provider error', async () => {
    mockFetchResponse(
      500,
      { error: { message: 'Internal server error', code: 500 } },
      'Internal Server Error'
    );

    const provider = new ZAIProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/500/);
  });

  test('throws on network timeout', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Request aborted'));

    const provider = new ZAIProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/request failed/i);
  });
});

describe('Z.AI Provider - Missing Credentials', () => {
  test('throws when ZAI_API_KEY is not set', async () => {
    const origKey = process.env.ZAI_API_KEY;
    delete process.env.ZAI_API_KEY;

    const provider = new ZAIProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/ZAI_API_KEY is required/);

    process.env.ZAI_API_KEY = origKey;
  });
});
