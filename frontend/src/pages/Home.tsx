import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { IncidentStatus } from '../../../shared/src/index';

export default function Home() {
  const [logText, setLogText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let textToAnalyze = logText;

      if (file && !logText) {
        const content = await file.text();
        textToAnalyze = content;
      }

      if (!textToAnalyze || textToAnalyze.trim().length === 0) {
        setError('Please paste CI log text or upload a log file.');
        setLoading(false);
        return;
      }

      const response = await api.analyze(textToAnalyze, file?.name);
      navigate(`/investigate/${response.incidentId}`);
    } catch (err: any) {
      setError(
        err.response?.data?.error || err.message || 'Analysis failed. Please try again.'
      );
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          FlakeTrail
        </h1>
        <p className="text-gray-600">
          Remember CI failures. Fix faster.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <form onSubmit={handleAnalyze} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              CI failure log
            </label>
            <textarea
              className="w-full h-64 rounded-lg border border-gray-300 p-4 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Paste your CI failure log here..."
              value={logText}
              onChange={(e) => {
                setLogText(e.target.value);
                setFile(null);
                setError(null);
              }}
            />
            <p className="mt-2 text-xs text-gray-500">
              Supports .log and .txt files, or paste log text directly.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Or upload a log file
            </label>
            <input
              type="file"
              accept=".log,.txt"
              className="w-full rounded-lg border border-gray-300 p-4 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              onChange={handleFileChange}
            />
            {file && (
              <p className="mt-2 text-xs text-gray-500">
                {file.name} ({file.size} bytes)
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex">
                <AlertTriangle className="w-5 h-5 text-red-600 mr-2" />
                <span className="text-sm text-red-700">{error}</span>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (!logText && !file)}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <FileText className="w-5 h-5" />
                Analyze failure
              </>
            )}
          </button>
        </form>
      </div>

      <div className="mt-8 text-center text-sm text-gray-500">
        <p>
          FlakeTrail remembers past CI investigations so you can reuse historical
          knowledge when similar failures happen again.
        </p>
      </div>
    </div>
  );
}
