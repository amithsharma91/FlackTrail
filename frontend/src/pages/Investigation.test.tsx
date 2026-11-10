import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Investigation from './Investigation';

const mockFetch = vi.fn();

// Build a fake fetch Response mirroring what api.getIncident consumes.
function mockResponse(body: any, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Not Found',
    json: async () => body,
  } as Response;
}

const mockIncident = {
  id: 'inc-123',
  parsedFailure: {
    testName: 'test_payment_retry',
    errorMessage: 'timeout after 30s waiting for payment gateway mock',
    failureSignature: 'sig-123',
    ciJobId: 'build-42',
    ciBranch: 'main',
    errorType: 'TimeoutError',
    stackTrace: 'at wait_for_response (payments/mock_gateway.py:42)',
    filePaths: ['payments/mock_gateway.py'],
    environment: {},
    timestamp: '2026-11-02T00:00:00Z',
    rawLogExcerpt: 'FAILED ... timeout after 30s ...',
  },
  historicalInvestigations: [
    {
      id: 'mem-1',
      testName: 'test_payment_retry',
      errorMessage: 'previous timeout',
      failureSignature: 'sig-123',
      status: 'verified',
      attemptedFix: 'Reset mock state between tests',
      timestamp: '2026-11-01T00:00:00Z',
      source: 'mem-1',
    },
  ],
  aiAnalysis: {
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
    relevantHistoricalIncidents: [],
    failedApproaches: [],
    verifiedApproaches: [],
    hasRelevantHistory: false,
  },
  status: 'proposed',
  outcome: undefined,
};

const renderPage = (incidentId = 'inc-123') =>
  render(
    <MemoryRouter initialEntries={[`/incidents/${incidentId}`]}>
      <Routes>
        <Route path="/incidents/:incidentId" element={<Investigation />} />
      </Routes>
    </MemoryRouter>
  );

// Some rendered text appears more than once on the page (e.g. the nav "Return to
// home" button and the in-content one), so presence is asserted via getAllByText.
const expectText = (text: RegExp | string) =>
  expect(screen.getAllByText(text).length).toBeGreaterThan(0);
const expectNoText = (text: RegExp | string) =>
  expect(screen.queryByText(text)).toBeNull();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Investigation page - loading / error / success states', () => {
  test('renders a loading spinner while the incident is being fetched', async () => {
    // fetch returns a promise that stays pending until we resolve it
    let resolveFetch!: (value: Response) => void;
    const pending = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    mockFetch.mockResolvedValue(pending);

    renderPage('inc-123');

    // Loading state is shown immediately (Spinner + label).
    expect(screen.getByRole('status')).toBeInTheDocument();
    expectText(/Loading investigation/);
    // No incident content yet.
    expectNoText(/timeout after 30s waiting for payment gateway mock/);

    await act(async () => {
      resolveFetch(mockResponse(mockIncident));
    });

    // Once resolved, the incident content appears.
    await waitFor(() => {
      expectText(/timeout after 30s waiting for payment gateway mock/);
      // test_payment_retry appears in both ErrorSummary and HistoryList.
      expect(screen.getAllByText(/test_payment_retry/)).toHaveLength(2);
    });
  });

  test('renders an error state when the incident fetch fails', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: 'Incident not found', status: 404 }, false, 404)
    );

    renderPage('inc-missing');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expectText(/Incident not found/);
      // A way back to home is offered.
      expectText(/Return to home/i);
    });
  });

  test('renders the complete incident on success (aiAnalysis + historicalInvestigations)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(mockIncident));

    renderPage('inc-123');

    await waitFor(() => {
      // Detected failure summary (parsedFailure).
      expectText(/Detected failure/);
      expectText(/timeout after 30s waiting for payment gateway mock/);
      expectText(/build-42/); // ciJobId
      expectText(/main/); // ciBranch

      // AI recommendations (aiAnalysis).
      expectText(/AI analysis & recommendations/);
      expectText(/The payment gateway mock timed out./);
      expectText(/Reset the mock state between tests./);

      // Historical investigations.
      expectText(/Similar past investigations/);
      expectText(/previous timeout/);

      // Outcome recording section.
      expectText(/Record investigation outcome/);
    });
  });

  test('shows "Investigation not found" when the backend returns no incident body', async () => {
    // 200 OK but a null body -> getIncident resolves with null -> !incident branch.
    mockFetch.mockResolvedValueOnce(mockResponse(null));

    renderPage('inc-does-not-exist');

    await waitFor(() => {
      expectText(/Investigation not found/);
      expectText(/Return to home/i);
      // No failure summary rendered in the not-found state.
      expectNoText(/Detected failure/);
    });
  });
});
