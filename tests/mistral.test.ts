import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { MistralProvider } from '../backend/src/llm/providers/mistral';
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

  process.env.MISTRAL_API_KEY = 'test-mistral-key';
  process.env.MISTRAL_MODEL = 'mistral-small-latest';
  process.env.MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';
  // Mistral is disabled by default
  process.env.MISTRAL_ENABLED = 'false';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Mistral Provider - Disabled by Default', () => {
  test('provider is disabled by default (MISTRAL_ENABLED != true)', async () => {
    const provider = new MistralProvider();
    expect(provider.provider).toBe('mistral');

    // chat() should throw because the provider is disabled
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/disabled/);
  });

  test('does not make any API calls when disabled', async () => {
    const provider = new MistralProvider();
    try {
      await provider.chat({ messages: [{ role: 'user', content: 'Hello' }] });
    } catch {
      // Expected to throw
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('can be enabled by setting MISTRAL_ENABLED=true', async () => {
    const origEnabled = process.env.MISTRAL_ENABLED;
    process.env.MISTRAL_ENABLED = 'true';

    mockFetchResponse(200, {
      id: 'chatcmpl-test',
      choices: [{ message: { role: 'assistant', content: 'Hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'mistral-small-latest',
    });

    const provider = new MistralProvider();
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.content).toBe('Hello');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    process.env.MISTRAL_ENABLED = origEnabled;
  });
});

describe('Mistral Provider - Configuration', () => {
  test('loads configuration from environment variables', () => {
    const provider = new MistralProvider({
      model: 'custom-model',
      baseUrl: 'https://custom.mistral.url/v1',
    });
    expect(provider).toBeInstanceOf(MistralProvider);
    expect(provider.provider).toBe('mistral');
  });

  test('uses default model when not specified', () => {
    const provider = new MistralProvider();
    expect(provider).toBeInstanceOf(MistralProvider);
  });
});

describe('Mistral Provider - Request Construction (when enabled)', () => {
  test('sends request to correct URL with auth header', async () => {
    const origEnabled = process.env.MISTRAL_ENABLED;
    process.env.MISTRAL_ENABLED = 'true';

    mockFetchResponse(200, {
      id: 'chatcmpl-test',
      choices: [{ message: { role: 'assistant', content: 'Hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'mistral-small-latest',
    });

    const provider = new MistralProvider();
    await provider.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-mistral-key'
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json'
    );
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('mistral-small-latest');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);

    process.env.MISTRAL_ENABLED = origEnabled;
  });

  test('includes system messages in request body', async () => {
    const origEnabled = process.env.MISTRAL_ENABLED;
    process.env.MISTRAL_ENABLED = 'true';

    mockFetchResponse(200, {
      id: 'chatcmpl-test',
      choices: [{ message: { role: 'assistant', content: 'Hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'mistral-small-latest',
    });

    const provider = new MistralProvider();
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

    process.env.MISTRAL_ENABLED = origEnabled;
  });
});

describe('Mistral Provider - Successful Response Parsing (when enabled)', () => {
  test('returns normalized response with content, provider, model, usage', async () => {
    const origEnabled = process.env.MISTRAL_ENABLED;
    process.env.MISTRAL_ENABLED = 'true';

    mockFetchResponse(200, {
      id: 'chatcmpl-123',
      choices: [{ message: { role: 'assistant', content: 'Analysis result' } }],
      usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
      model: 'mistral-small-latest',
    });

    const provider = new MistralProvider();
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Analyze this' }],
    });

    expect(result.content).toBe('Analysis result');
    expect(result.provider).toBe('mistral');
    expect(result.model).toBe('mistral-small-latest');
    expect(result.usage?.inputTokens).toBe(15);
    expect(result.usage?.outputTokens).toBe(25);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    process.env.MISTRAL_ENABLED = origEnabled;
  });

  test('response passes strict LLMAnalysisSchema validation', async () => {
    const origEnabled = process.env.MISTRAL_ENABLED;
    process.env.MISTRAL_ENABLED = 'true';

    mockFetchResponse(200, {
      id: 'chatcmpl-test',
      choices: [{ message: { role: 'assistant', content: JSON.stringify(validAnalysis) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'mistral-small-latest',
    });

    const provider = new MistralProvider();
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Analyze this' }],
    });

    const validated = LLMAnalysisSchema.safeParse(JSON.parse(result.content));
    expect(validated.success).toBe(true);

    process.env.MISTRAL_ENABLED = origEnabled;
  });
});

describe('Mistral Provider - Error Handling (when enabled)', () => {
  test('throws on empty response', async () => {
    const origEnabled = process.env.MISTRAL_ENABLED;
    process.env.MISTRAL_ENABLED = 'true';

    mockFetchResponse(200, {
      id: 'chatcmpl-empty',
      choices: [{ message: { role: 'assistant', content: '' } }],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      model: 'mistral-small-latest',
    });

    const provider = new MistralProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/empty analysis response/);

    process.env.MISTRAL_ENABLED = origEnabled;
  });

  test('throws on 401 authentication error', async () => {
    const origEnabled = process.env.MISTRAL_ENABLED;
    process.env.MISTRAL_ENABLED = 'true';

    mockFetchResponse(
      401,
      { error: { message: 'Incorrect API key', code: 401 } },
      'Unauthorized'
    );

    const provider = new MistralProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/401/);

    process.env.MISTRAL_ENABLED = origEnabled;
  });

  test('throws on 403 permission error', async () => {
    const origEnabled = process.env.MISTRAL_ENABLED;
    process.env.MISTRAL_ENABLED = 'true';

    mockFetchResponse(
      403,
      { error: { message: 'Insufficient permissions', code: 403 } },
      'Forbidden'
    );

    const provider = new MistralProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/403/);

    process.env.MISTRAL_ENABLED = origEnabled;
  });

  test('throws on 429 rate limit', async () => {
    const origEnabled = process.env.MISTRAL_ENABLED;
    process.env.MISTRAL_ENABLED = 'true';

    mockFetchResponse(
      429,
      { error: { message: 'Rate limit exceeded', code: 429 } },
      'Too Many Requests'
    );

    const provider = new MistralProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/429/);

    process.env.MISTRAL_ENABLED = origEnabled;
  });

  test('throws on 5xx provider error', async () => {
    const origEnabled = process.env.MISTRAL_ENABLED;
    process.env.MISTRAL_ENABLED = 'true';

    mockFetchResponse(
      500,
      { error: { message: 'Internal server error', code: 500 } },
      'Internal Server Error'
    );

    const provider = new MistralProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/500/);

    process.env.MISTRAL_ENABLED = origEnabled;
  });

  test('throws on network timeout', async () => {
    const origEnabled = process.env.MISTRAL_ENABLED;
    process.env.MISTRAL_ENABLED = 'true';

    mockFetch.mockRejectedValueOnce(new Error('Request aborted'));

    const provider = new MistralProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/request failed/i);

    process.env.MISTRAL_ENABLED = origEnabled;
  });
});

describe('Mistral Provider - Missing Credentials', () => {
  test('throws when MISTRAL_API_KEY is not set (when enabled)', async () => {
    const origEnabled = process.env.MISTRAL_ENABLED;
    const origKey = process.env.MISTRAL_API_KEY;
    process.env.MISTRAL_ENABLED = 'true';
    delete process.env.MISTRAL_API_KEY;

    const provider = new MistralProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/MISTRAL_API_KEY is required/);

    process.env.MISTRAL_API_KEY = origKey;
    process.env.MISTRAL_ENABLED = origEnabled;
  });
});
