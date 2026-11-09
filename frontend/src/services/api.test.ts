import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Regression tests for production bug:
 * "Analyze failure" displayed "Not found" because VITE_API_BASE_URL was
 * configured with a trailing slash ("https://backend.onrender.com/"),
 * producing double-slash URLs like:
 *   https://backend.onrender.com//api/analyze  -> Express 404 "Not found"
 *
 * The fix normalizes the base URL by stripping trailing slashes.
 */
describe('API URL building (production double-slash regression)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'inc-test-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test('strips a single trailing slash from VITE_API_BASE_URL', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://flaketrail-backend.onrender.com/');

    const { api } = await import('./api');
    await api.getIncident('inc-test-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe(
      'https://flaketrail-backend.onrender.com/api/incidents/inc-test-1'
    );
    expect(calledUrl).not.toContain('//api');
  });

  test('strips multiple trailing slashes from VITE_API_BASE_URL', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://flaketrail-backend.onrender.com///');

    const { api } = await import('./api');
    await api.getIncident('inc-test-1');

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe(
      'https://flaketrail-backend.onrender.com/api/incidents/inc-test-1'
    );
  });

  test('keeps base URL unchanged when it has no trailing slash', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://flaketrail-backend.onrender.com');

    const { api } = await import('./api');
    await api.getIncident('inc-test-1');

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe(
      'https://flaketrail-backend.onrender.com/api/incidents/inc-test-1'
    );
  });

  test('analyze POST uses normalized URL (no double slash)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://flaketrail-backend.onrender.com/');

    const { api } = await import('./api');
    await api.analyze('FAILED test_x - Error: boom');

    const [calledUrl, options] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      'https://flaketrail-backend.onrender.com/api/analyze'
    );
    expect(options.method).toBe('POST');
    expect(calledUrl).not.toContain('//api');
  });

  test('falls back to relative paths when base URL is empty (local dev)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');

    const { api } = await import('./api');
    await api.getIncident('inc-test-1');

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe('/api/incidents/inc-test-1');
  });

  test('resolveIncident POST uses normalized URL', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://flaketrail-backend.onrender.com/');

    const { api } = await import('./api');
    await api.resolveIncident('inc-test-1', { status: 'failed' });

    const [calledUrl, options] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      'https://flaketrail-backend.onrender.com/api/incidents/inc-test-1/resolve'
    );
    expect(options.method).toBe('POST');
  });

  test('listIncidents GET uses normalized URL', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://flaketrail-backend.onrender.com/');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ incidents: [] }),
    });

    const { api } = await import('./api');
    await api.listIncidents();

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe('https://flaketrail-backend.onrender.com/api/incidents');
  });

  test('error responses propagate the backend error message', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://flaketrail-backend.onrender.com/');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Incident not found', status: 404 }),
    });

    const { api } = await import('./api');
    await expect(api.getIncident('inc-missing')).rejects.toThrow(
      'Incident not found'
    );
  });
});
