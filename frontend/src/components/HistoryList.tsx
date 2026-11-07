import { HistoricalInvestigation } from '../../../shared/src/index';

interface HistoryListProps {
  investigations: HistoricalInvestigation[];
}

export default function HistoryList({ investigations }: HistoryListProps) {
  return (
    <div className="space-y-3">
      {investigations.map((inv) => (
        <div key={inv.id} className="border rounded-lg p-4">
          <p className="text-sm font-medium text-gray-900">{inv.testName}</p>
          <p className="text-xs text-gray-600 break-all">{inv.errorMessage}</p>
          <span className="text-xs font-medium">
            Status: {inv.status}
          </span>
        </div>
      ))}
    </div>
  );
}
