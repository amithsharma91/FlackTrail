import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, Github, List } from 'lucide-react';
import { api } from '../services/api';
import { HistoricalInvestigation } from '../../../shared/src/index';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import Spinner from '../components/Spinner';
import ErrorAlert from '../components/ErrorAlert';

export default function History() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState<HistoricalInvestigation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listIncidents()
      .then((data: { incidents: HistoricalInvestigation[] }) => {
        setIncidents(data.incidents ?? []);
      })
      .catch((err: any) => {
        setError(err.response?.data?.error || err.message || 'Failed to load investigation history');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-gray-600">
        <Spinner size="lg" label="Loading history…" />
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

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <nav className="mb-6 flex items-center gap-2">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" /> Back to home
        </button>
      </nav>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Investigation history</h1>
          <p className="text-gray-600">All recorded CI failure investigations in FlakeTrail memory.</p>
        </div>
        <a
          href="/"
          className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium"
        >
          <List className="w-4 h-4" aria-hidden="true" />
          New investigation
        </a>
      </div>

      {incidents.length === 0 ? (
        <EmptyState
          icon={<Clock className="w-8 h-8" aria-hidden="true" />}
          title="No investigations yet"
          description="Submit a CI failure log from the home page to begin building FlakeTrail's investigation memory."
          action={
            <a
              href="/"
              className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              <List className="w-4 h-4" aria-hidden="true" />
              Submit a log
            </a>
          }
        />
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm divide-y divide-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Test</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">CI job / branch</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">PR</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {incidents.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900 truncate">{inv.testName}</div>
                    <div className="text-xs text-gray-500 truncate">{inv.errorMessage}</div>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={inv.status} size="md" />
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-gray-900">{new Date(inv.timestamp).toLocaleDateString()}</div>
                    <div className="text-xs text-gray-500">{new Date(inv.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {inv.ciJobId || '—'}{inv.ciBranch && <span className="ml-1 text-gray-400">· {inv.ciBranch}</span>}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {inv.prLink ? (
                      <a
                        href={inv.prLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline flex items-center justify-end gap-1"
                      >
                        <Github className="w-3 h-3" aria-hidden="true" />
                        View PR
                      </a>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
