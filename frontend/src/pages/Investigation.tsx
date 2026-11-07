import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Copy, CheckCircle2, XCircle, AlertTriangle, Loader2, FileText } from 'lucide-react';
import { api } from '../services/api';
import { ParsedFailure, HistoricalInvestigation, AIAnalysis, IncidentStatus } from '../../../shared/src/index';

export default function Investigation() {
  const { incidentId } = useParams<{ incidentId: string }>();
  const navigate = useNavigate();
  const [incident, setIncident] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcomeLoading, setOutcomeLoading] = useState(false);

  useEffect(() => {
    loadIncident();
  }, [incidentId]);

  const loadIncident = async () => {
    try {
      setLoading(true);
      const data = await api.getIncident(incidentId!);
      setIncident(data);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load incident');
    } finally {
      setLoading(false);
    }
  };

  const recordOutcome = async (status: IncidentStatus, ciResult?: 'passed' | 'failed', merged?: boolean) => {
    setOutcomeLoading(true);
    try {
      await api.resolveIncident(incidentId!, {
        incidentId: incidentId!,
        status,
        ciResult,
        merged,
      });
      loadIncident();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to save outcome');
    } finally {
      setOutcomeLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="mt-2 text-gray-600">Loading investigation...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <XCircle className="w-6 h-6 text-red-600" />
          <h2 className="text-lg font-semibold text-red-800 mb-2">Error</h2>
          <p className="text-red-700">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 text-blue-600 hover:underline text-sm"
          >
            Return to home
          </button>
        </div>
      </div>
    );
  }

  if (!incident) return null;

  const { parsedFailure, historicalInvestigations, aiAnalysis, status, outcome } = incident;

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <nav className="mb-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" /> Back to home
        </button>
      </nav>

      <div className="space-y-6">
        {/* Detected Error */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Detected failure
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Test</p>
              <p className="font-mono text-sm">{parsedFailure.testName}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">CI job</p>
              <p className="font-mono text-sm">{parsedFailure.ciJobId || 'N/A'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Branch</p>
              <p className="font-mono text-sm">{parsedFailure.ciBranch || 'N/A'}</p>
            </div>
            <div className="md:col-span-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Error message</p>
              <p className="font-mono text-sm text-gray-700 break-all">{parsedFailure.errorMessage}</p>
            </div>
          </div>
        </section>

        {/* Historical Investigations */}
        {historicalInvestigations.length > 0 && (
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Similar past investigations
            </h2>
            <div className="space-y-3">
              {historicalInvestigations.map((inv: HistoricalInvestigation, i: number) => (
                <div
                  key={inv.id}
                  className="border rounded-lg p-4 flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium text-gray-900">{inv.testName}</p>
                    <p className="text-sm text-gray-600 break-all">
                      {inv.errorMessage}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        inv.status === 'verified'
                          ? 'bg-green-100 text-green-700'
                          : inv.status === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {inv.status}
                    </span>
                    {inv.prLink && (
                      <a
                        href={inv.prLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        View PR
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* AI Analysis */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            AI analysis & recommendations
          </h2>

          <div className="mb-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Likely cause</p>
            <p className="text-gray-700">{aiAnalysis.failureSummary}</p>
          </div>

          {aiAnalysis.possibleCauses.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Possible causes</p>
              <ul className="space-y-2">
                {aiAnalysis.possibleCauses.map((cause: any, i: number) => (
                  <li key={i} className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-800">{cause.cause}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Evidence: {cause.evidence.join(', ')}
                    </p>
                    <span className="text-xs text-gray-400">Confidence: {cause.confidence}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Recommended steps</p>
            <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
              {aiAnalysis.recommendedSteps.map((step: string, i: number) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="pt-4 border-t border-gray-200">
            <p className="text-xs text-gray-500">
              Confidence: <span className="font-medium">{aiAnalysis.confidence}</span>
            </p>
            <p className="text-xs text-gray-500">
              {aiAnalysis.uncertaintyExplanation}
            </p>
            {!aiAnalysis.hasRelevantHistory && (
              <p className="text-xs text-amber-600 mt-1">
                No relevant historical memory found. This appears to be a new failure pattern.
              </p>
            )}
          </div>
        </section>

        {/* Record Outcome */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Record investigation outcome
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Help FlakeTrail remember what worked. Select the outcome of your investigation.
          </p>

          <div className="space-y-3">
            <button
              onClick={() => recordOutcome('failed')}
              disabled={outcomeLoading}
              className="w-full py-3 px-4 border border-gray-300 rounded-lg text-left hover:bg-gray-50 disabled:opacity-50"
            >
              <span className="font-medium">CI still failed</span>
              <span className="text-sm text-gray-500 block">Mark this attempt as failed</span>
            </button>

            <button
              onClick={() => recordOutcome('passed_unmerged')}
              disabled={outcomeLoading}
              className="w-full py-3 px-4 border border-gray-300 rounded-lg text-left hover:bg-gray-50 disabled:opacity-50"
            >
              <span className="font-medium">CI passed, not merged</span>
              <span className="text-sm text-gray-500 block">Fix passed CI but change not yet merged</span>
            </button>

            <button
              onClick={() => {
                const confirmed = window.confirm(
                  'Mark as verified? This requires CI to have passed AND the change to be merged.'
                );
                if (confirmed) {
                  recordOutcome('verified', 'passed', true);
                }
              }}
              disabled={outcomeLoading}
              className="w-full py-3 px-4 border border-green-300 bg-green-50 rounded-lg text-left hover:bg-green-100 disabled:opacity-50"
            >
              <span className="font-medium text-green-700">CI passed + merged (Verified)</span>
              <span className="text-sm text-green-600 block">Confirmed fix - will be remembered by FlakeTrail</span>
            </button>
          </div>

          {outcome && (
            <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
              <CheckCircle2 className="w-5 h-5 text-green-600 mr-2" />
              <span className="text-sm text-green-700">
                Outcome saved: {outcome.status}
              </span>
            </div>
          )}
        </section>

        {outcome && (
          <div className="text-center">
            <button
              onClick={() => navigate('/')}
              className="text-blue-600 hover:underline text-sm"
            >
              Analyze another failure
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
