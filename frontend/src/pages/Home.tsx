import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, FileText, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import UploadZone from '../components/UploadZone';
import ErrorAlert from '../components/ErrorAlert';
import Spinner from '../components/Spinner';

export default function Home() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSubmittedText, setLastSubmittedText] = useState<string | null>(null);

  const hasInput = text.trim().length > 0 || file !== null;

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let textToAnalyze = text;

      if (file && !text) {
        textToAnalyze = await file.text();
      }

      if (!textToAnalyze || textToAnalyze.trim().length === 0) {
        setError('Please paste CI log text or upload a .log/.txt file before analyzing.');
        setLoading(false);
        return;
      }

      const response = await api.analyze(textToAnalyze, file?.name);
      setLastSubmittedText(textToAnalyze);
      navigate(`/investigate/${response.incidentId}`);
    } catch (err: any) {
      // Never log raw log text or secrets to the console.
      setError(
        err.response?.data?.error || err.message || 'Analysis failed. Please try again.'
      );
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    if (!lastSubmittedText) return;
    setError(null);
    setLoading(true);

    try {
      const response = await api.analyze(lastSubmittedText);
      setLoading(false);
      navigate(`/investigate/${response.incidentId}`);
    } catch (err: any) {
      setError(
        err.response?.data?.error || err.message || 'Analysis failed. Please try again.'
      );
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-200">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">FlakeTrail<span className="text-blue-600">.</span>ai</h1>
            <p className="text-xs text-gray-500">Remember CI failures. Fix faster.</p>
          </div>
          <div className="ml-auto flex items-center gap-2 px-3 py-1 rounded-full border border-gray-200 bg-white text-xs text-gray-600">
            <Zap className="w-3 h-3 mr-1" aria-hidden="true" />
            Analyze CI logs
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto py-10 px-4">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Submit a CI failure log</h2>
          <p className="text-gray-600 max-w-xl mx-auto">
            Paste your CI failure log or upload a <span className="font-mono">.log</span> /
            <span className="font-mono">.txt</span> file. FlakeTrail parses the failure, recalls similar
            historical investigations, and returns AI-powered recommendations.
          </p>
        </div>

        <form onSubmit={handleAnalyze} className="space-y-6">
          <UploadZone
            text={text}
            file={file}
            onTextChange={setText}
            onFileChange={setFile}
            disabled={loading}
          />

          {error && (
            <div className="space-y-3">
              <ErrorAlert message={error} onDismiss={() => setError(null)} />
              {lastSubmittedText && (
                <button
                  onClick={handleRetry}
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Spinner size="sm" label="Retrying" className="text-white" />
                      Retrying…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" aria-hidden="true" />
                      Retry Analysis
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !hasInput}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:hover:bg-gray-300 text-white font-semibold py-3.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Spinner size="sm" label="Analyzing" className="text-white" />
                Analyzing…
              </>
            ) : (
              <>
                <Zap className="w-5 h-5" aria-hidden="true" />
                Analyze failure
              </>
            )}
          </button>

          <p className="text-xs text-gray-500">
            Logs are sent to your backend only. Secrets are redacted before any AI or Hindsight call — nothing is logged in the browser.
          </p>
        </form>
      </main>
    </div>
  );
}
