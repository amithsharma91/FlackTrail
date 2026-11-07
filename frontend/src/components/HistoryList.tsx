import { HistoricalInvestigation } from '../../../shared/src/index';
import { Github, Clock } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { formatDate } from '../lib/utils';

interface HistoryListProps {
  investigations: HistoricalInvestigation[];
  emptyMessage?: string;
  showEmptyState?: boolean;
}

export default function HistoryList({
  investigations,
  emptyMessage = 'No similar historical investigations found.',
  showEmptyState = true,
}: HistoryListProps) {
  if (investigations.length === 0) {
    if (!showEmptyState) return null;
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
        <Clock className="w-8 h-8 mx-auto mb-3 text-gray-400" aria-hidden="true" />
        <p className="text-sm text-gray-600">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {investigations.map((inv) => (
        <div key={inv.id} className="border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-gray-900 truncate">{inv.testName}</p>
            <p className="text-sm text-gray-600 break-all truncate sm:truncate">
              {inv.errorMessage}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="text-gray-500">
                <Clock className="w-3 h-3 mr-1" aria-hidden="true" />
                {formatDate(inv.timestamp)}
              </span>
              {inv.ciJobId && (
                <span className="text-gray-500">· {inv.ciJobId}</span>
              )}
              {inv.ciBranch && (
                <span className="text-gray-500">· {inv.ciBranch}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap sm:justify-end">
            <StatusBadge status={inv.status} size="sm" />
            {inv.prLink && (
              <a
                href={inv.prLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
              >
                <Github className="w-3 h-3" aria-hidden="true" />
                View PR
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
