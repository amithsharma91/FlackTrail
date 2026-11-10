import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { NVIDIAProvider } from '../backend/src/llm/providers/nvidia';
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

  process.env.NVIDIA_API_KEY = 'test-nvidia-key';
  process.env.NVIDIA_MODEL = 'meta/llama-3.1-8b-instruct';
  process.env.NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
  process.env.NVIDIA_ENABLED = 'true';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NVIDIA Provider - Configuration', () => {
  test('loads configuration from environment variables', () => {
    const provider = new NVIDIAProvider({
      model: 'custom-model',
      baseUrl: 'https://custom.nvidia.url/v1',
    });
    expect(provider).toBeInstanceOf(NVIDIAProvider);
    expect(provider.provider).toBe('nvidia');
  });

  test('uses default model when not specified', () => {
    const provider = new NVIDIAProvider();
    expect(provider).toBeInstanceOf(NVIDIAProvider);
  });

  test('is disabled when NVIDIA_ENABLED=false', async () => {
    const origEnabled = process.env.NVIDIA_ENABLED;
    process.env.NVIDIA_ENABLED = 'false';
    const provider = new NVIDIAProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/disabled/);
    process.env.NVIDIA_ENABLED = origEnabled;
  });
});

describe('NVIDIA Provider - Request Construction', () => {
  test('sends request to correct URL with auth header', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-test',
      choices: [{ message: { role: 'assistant', content: 'Hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'meta/llama-3.1-8b-instruct',
    });

    const provider = new NVIDIAProvider();
    await provider.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-nvidia-key'
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json'
    );
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('meta/llama-3.1-8b-instruct');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(body.stream).toBe(false);
  });

  test('includes system messages in request body', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-test',
      choices: [{ message: { role: 'assistant', content: 'Hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'meta/llama-3.1-8b-instruct',
    });

    const provider = new NVIDIAProvider();
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

describe('NVIDIA Provider - Successful Response Parsing', () => {
  test('returns normalized response with content, provider, model, usage', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-123',
      choices: [{ message: { role: 'assistant', content: 'Analysis result' } }],
      usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
      model: 'meta/llama-3.1-8b-instruct',
    });

    const provider = new NVIDIAProvider();
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Analyze this' }],
    });

    expect(result.content).toBe('Analysis result');
    expect(result.provider).toBe('nvidia');
    expect(result.model).toBe('meta/llama-3.1-8b-instruct');
    expect(result.usage?.inputTokens).toBe(15);
    expect(result.usage?.outputTokens).toBe(25);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('response passes strict LLMAnalysisSchema validation', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-test',
      choices: [{ message: { role: 'assistant', content: JSON.stringify(validAnalysis) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'meta/llama-3.1-8b-instruct',
    });

    const provider = new NVIDIAProvider();
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

describe('NVIDIA Provider - Error Handling', () => {
  test('throws on empty response', async () => {
    mockFetchResponse(200, {
      id: 'chatcmpl-empty',
      choices: [{ message: { role: 'assistant', content: '' } }],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      model: 'meta/llama-3.1-8b-instruct',
    });

    const provider = new NVIDIAProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/empty analysis response/);
  });

  test('throws on 401 authentication error', async () => {
    mockFetchResponse(
      401,
      { error: { message: 'Incorrect API key', code: 401 } },
      'Unauthorized'
    );

    const provider = new NVIDIAProvider();
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

    const provider = new NVIDIAProvider();
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

    const provider = new NVIDIAProvider();
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

    const provider = new NVIDIAProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/500/);
  });

  test('throws on network timeout', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Request aborted'));

    const provider = new NVIDIAProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/request failed/i);
  });
});

describe('NVIDIA Provider - Missing Credentials', () => {
  test('throws when NVIDIA_API_KEY is not set', async () => {
    const origKey = process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_API_KEY;

    const provider = new NVIDIAProvider();
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toThrow(/NVIDIA_API_KEY is required/);

    process.env.NVIDIA_API_KEY = origKey;
  });
});
