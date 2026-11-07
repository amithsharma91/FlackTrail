import { AIAnalysis, HistoricalInvestigation } from '../../../shared/src/index';
import { AlertTriangle, Database, Brain, ShieldCheck, ShieldAlert, List, Clock } from 'lucide-react';
import StatusBadge from './StatusBadge';

interface AIRecommendationsProps {
  analysis: AIAnalysis;
}

function ConfidenceBadge({ confidence }: { confidence: 'low' | 'medium' | 'high' }) {
  const config = {
    low: 'bg-amber-100 text-amber-700 border-amber-200',
    medium: 'bg-blue-100 text-blue-700 border-blue-200',
    high: 'bg-green-100 text-green-700 border-green-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${config[confidence]}`}>
      Confidence: {confidence}
    </span>
  );
}

export default function AIRecommendations({ analysis }: AIRecommendationsProps) {
  const { failureSummary, possibleCauses, recommendedSteps, confidence, uncertaintyExplanation, hasRelevantHistory } = analysis;

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-5 h-5 text-amber-600" />
        <h2 className="text-lg font-semibold text-gray-900">AI analysis &amp; recommendations</h2>
      </div>

      {/* Failure summary */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-xs font-medium text-amber-700 uppercase tracking-wider mb-1">Failure summary</p>
        <p className="text-gray-800">{failureSummary}</p>
      </div>

      {/* Verified history section - evidence, not speculation */}
      {hasRelevantHistory && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-5 h-5 text-green-600" />
            <h3 className="text-sm font-semibold text-green-800">Based on verified historical memory</h3>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            These outcomes were confirmed in CI (passed and merged) — they are evidence, not AI inference.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {analysis.verifiedApproaches.length > 0 && (
              <div className="bg-green-50 rounded-lg border border-green-100 p-4">
                <p className="text-xs font-medium text-green-700 uppercase tracking-wider mb-3">Proven fixes</p>
                <ul className="space-y-2 text-sm text-gray-800">
                  {analysis.verifiedApproaches.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <ShieldCheck className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{a.approach}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {analysis.failedApproaches.length > 0 && (
              <div className="bg-red-50 rounded-lg border border-red-100 p-4">
                <p className="text-xs font-medium text-red-700 uppercase tracking-wider mb-3">Approaches that did not work</p>
                <ul className="space-y-2 text-sm text-gray-800">
                  {analysis.failedApproaches.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <ShieldAlert className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{a.approach}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}

      {/* AI-suggested causes - clearly marked as inference */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-5 h-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-blue-800">AI-suggested possible causes</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          These causes are AI inference from the current log. They are not verified unless linked to historical memory above.
        </p>
        <div className="space-y-3">
          {possibleCauses.length > 0 ? (
            possibleCauses.map((cause, i) => (
              <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex justify-between items-start mb-2">
                  <p className="font-medium text-gray-900">{cause.cause}</p>
                  <ConfidenceBadge confidence={cause.confidence} />
                </div>
                <p className="text-xs text-gray-600 mb-2">
                  <span className="font-medium text-gray-700">Evidence:</span> {cause.evidence.join('; ')}
                </p>
                <span className="text-xs text-gray-400">AI inference &bull; confidence: {cause.confidence}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500">No specific causes identified.</p>
          )}
        </div>
      </div>

      {/* Recommended steps with provenance */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <List className="w-5 h-5 text-gray-600" />
          <h3 className="text-sm font-semibold text-gray-800">Recommended steps</h3>
        </div>
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700 divide-y divide-gray-100">
          {recommendedSteps.map((step, i) => (
            <li key={i} className="py-2 flex items-start gap-2">
              <span className="text-xs font-medium text-blue-600 shrink-0">AI-suggested</span>
              <p>{step}</p>
            </li>
          ))}
        </ol>
      </div>

      {/* Confidence & uncertainty */}
      <div className="pt-4 border-t border-gray-200 space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Overall confidence</p>
          <ConfidenceBadge confidence={confidence} />
        </div>
        <p className="text-xs text-gray-600">{uncertaintyExplanation}</p>
      </div>

      {!hasRelevantHistory && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-700">
            <Clock className="w-3 h-3 mr-1" aria-hidden="true" />
            No relevant historical memory found. This appears to be a new failure pattern; recommendations are AI inference only.
          </p>
        </div>
      )}
    </section>
  );
}
