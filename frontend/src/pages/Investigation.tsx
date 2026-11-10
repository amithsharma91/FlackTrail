import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { IncidentDetailResponse, ParsedFailure, HistoricalInvestigation, AIAnalysis, IncidentStatus } from '../../../shared/src/index';
import ErrorSummary from '../components/ErrorSummary';
import HistoryList from '../components/HistoryList';
import AIRecommendations from '../components/AIRecommendations';
import OutcomeControls from '../components/OutcomeControls';
import ReflectNotice from '../components/ReflectNotice';
import Spinner from '../components/Spinner';
import ErrorAlert from '../components/ErrorAlert';

export default function Investigation() {
  const { incidentId } = useParams<{ incidentId: string }>();
  const navigate = useNavigate();
  const [incident, setIncident] = useState<IncidentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcomeLoading, setOutcomeLoading] = useState(false);
  const [reflectLoading, setReflectLoading] = useState(false);
  const [saved, setSaved] = useState<boolean>(false);

  useEffect(() => {
    loadIncident();
  }, [incidentId]);

  const loadIncident = async () => {
    setError(null);
    setSaved(false);
    try {
      setLoading(true);
      const data = await api.getIncident(incidentId!);
      setIncident(data);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load investigation');
    } finally {
      setLoading(false);
    }
  };

  const handleRecordOutcome = async (submission: Omit<Parameters<typeof api.resolveIncident>[1], 'incidentId'>) => {
    setError(null);
    setOutcomeLoading(true);
    try {
      await api.resolveIncident(incidentId!, { incidentId: incidentId!, ...submission });
      setSaved(true);
      loadIncident();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to save outcome');
    } finally {
      setOutcomeLoading(false);
    }
  };

  const handleReflect = async () => {
    setError(null);
    setReflectLoading(true);
    try {
      await api.reflect(incidentId!);
      loadIncident();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'REFLECT failed. It may not be available.');
    } finally {
      setReflectLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-gray-600">
        <Spinner size="lg" label="Loading investigation…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-10 px-4">
        <div className="max-w-lg mx-auto">
          <ErrorAlert message={error} onDismiss={() => setError(null)} />
          <div className="mt-6 flex justify-center">
            <button
              onClick={() => navigate('/')}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" />
              Return to home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="max-w-4xl mx-auto py-10 px-4">
        <div className="max-w-lg mx-auto text-center">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Investigation not found</h2>
          <p className="text-gray-600 mb-6">
            No investigation data was returned for this incident. The report may have been removed or the data is unavailable.
          </p>
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Return to home
          </button>
        </div>
      </div>
    );
  }

  const { parsedFailure, historicalInvestigations, aiAnalysis, status, outcome } = incident;

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <nav className="mb-6 flex items-center gap-2">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" /> Back to home
        </button>
        {outcome && (
          <span className="ml-auto px-2 py-1 rounded-full border border-green-200 bg-green-50 text-green-700 text-xs font-medium">
            Saved: {status.replace(/_/g, ' ')}
          </span>
        )}
      </nav>

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      {/* Detected failure summary */}
      <ErrorSummary failure={parsedFailure as ParsedFailure} />

      {/* Historical investigations */}
      <section className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-gray-500" aria-hidden="true" />
            Similar past investigations
          </h2>
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            {historicalInvestigations.length} found
          </span>
        </div>
        <HistoryList
          investigations={historicalInvestigations as HistoricalInvestigation[]}
          emptyMessage="No similar historical investigations found. This is the first time this failure signature has been seen."
        />
      </section>

      {/* AI recommendations */}
      <AIRecommendations analysis={aiAnalysis as AIAnalysis} />

      {/* Optional REFLECT */}
      <ReflectNotice onReflect={handleReflect} loading={reflectLoading} />

      {/* Record outcome */}
      <section className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Record investigation outcome</h2>
        <p className="text-sm text-gray-600 mb-4">
          Help FlakeTrail remember what worked. <b>Verified</b> outcomes are saved to Hindsight memory so
          future similar failures can reuse proven fixes.
        </p>
        <OutcomeControls
          onRecord={handleRecordOutcome}
          loading={outcomeLoading}
          status={status as IncidentStatus}
        />
      </section>

      {saved && (
        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Analyze another failure
          </button>
        </div>
      )}
    </div>
  );
}
