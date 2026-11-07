import { AIAnalysis } from '../../../shared/src/index';

interface AIRecommendationsProps {
  analysis: AIAnalysis;
}

export default function AIRecommendations({ analysis }: AIRecommendationsProps) {
  return (
    <div className="p-4 bg-blue-50 rounded-lg">
      <h3 className="text-sm font-medium text-blue-900 mb-2">AI recommendations</h3>
      <p className="text-xs text-blue-700 mb-2">{analysis.failureSummary}</p>
      <ul className="list-disc list-inside text-xs text-blue-700 space-y-1">
        {analysis.recommendedSteps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ul>
    </div>
  );
}
