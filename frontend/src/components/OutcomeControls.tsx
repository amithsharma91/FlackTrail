import { IncidentStatus } from '../../../shared/src/index';

interface OutcomeControlsProps {
  onRecord: (status: IncidentStatus) => void;
  loading?: boolean;
}

export default function OutcomeControls({ onRecord, loading }: OutcomeControlsProps) {
  return (
    <div className="space-y-3">
      <button
        onClick={() => onRecord('failed')}
        disabled={loading}
        className="w-full py-3 px-4 border border-red-300 rounded-lg text-left hover:bg-red-50 disabled:opacity-50"
      >
        <span className="font-medium text-red-700">CI still failed</span>
      </button>
      <button
        onClick={() => onRecord('passed_unmerged')}
        disabled={loading}
        className="w-full py-3 px-4 border border-yellow-300 rounded-lg text-left hover:bg-yellow-50 disabled:opacity-50"
      >
        <span className="font-medium text-yellow-700">CI passed, not merged</span>
      </button>
      <button
        onClick={() => onRecord('verified')}
        disabled={loading}
        className="w-full py-3 px-4 border border-green-300 bg-green-50 rounded-lg text-left hover:bg-green-100 disabled:opacity-50"
      >
        <span className="font-medium text-green-700">Verified (CI passed + merged)</span>
      </button>
    </div>
  );
}
