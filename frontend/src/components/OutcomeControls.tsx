import { useState } from 'react';
import { IncidentStatus, OutcomeSubmission } from '../../../shared/src/index';
import { AlertCircle, CheckCircle2, X, RefreshCw } from 'lucide-react';

interface OutcomeControlsProps {
  onRecord: (submission: Omit<OutcomeSubmission, 'incidentId'>) => void;
  loading?: boolean;
  status?: IncidentStatus;
}

interface VerifiedConfirmProps {
  onConfirm: (ciResult: 'passed', merged: true) => void;
  onCancel: () => void;
  loading: boolean;
}

function VerifiedConfirmDialog({ onConfirm, onCancel, loading }: VerifiedConfirmProps) {
  const [ciPassed, setCiPassed] = useState(false);
  const [merged, setMerged] = useState(false);

  const bothConfirmed = ciPassed && merged;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="verified-dialog-title">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md mx-4 bg-white rounded-xl shadow-2xl p-6">
        <div className="flex items-start gap-3 mb-4">
          <AlertCircle className="w-6 h-6 text-amber-500 shrink-0" />
          <div>
            <h3 id="verified-dialog-title" className="text-base font-semibold text-gray-900">
              Confirm "Verified" outcome
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              A <b>verified</b> fix is only saved to FlakeTrail memory when <b>both</b> conditions are true:
            </p>
            <ul className="list-disc list-inside text-sm text-gray-700 mt-2 space-y-1">
              <li>CI has passed for the fix, <b>and</b></li>
              <li>the change has been merged.</li>
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              <input
                type="checkbox"
                checked={ciPassed}
                onChange={(e) => setCiPassed(e.target.checked)}
                className="mr-2 text-blue-600 focus:ring-blue-500"
              />
              I confirm CI passed for this fix
            </label>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              <input
                type="checkbox"
                checked={merged}
                onChange={(e) => setMerged(e.target.checked)}
                className="mr-2 text-blue-600 focus:ring-blue-500"
              />
              I confirm the change has been merged
            </label>
          </div>

          <div className="pt-4 flex items-center justify-between gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm('passed', true)}
              disabled={loading || !bothConfirmed}
              className="flex-1 py-2.5 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Saving...
                </>
              ) : bothConfirmed ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Confirm verified
                </>
              ) : (
                'Confirm both conditions above'
              )}
            </button>
          </div>
          {!bothConfirmed && !loading && (
            <p className="text-xs text-amber-600 text-center">
              Check both boxes to enable the Verified outcome.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OutcomeControls({ onRecord, loading = false, status }: OutcomeControlsProps) {
  const [showVerifiedConfirm, setShowVerifiedConfirm] = useState(false);

  const handleFailed = () => {
    onRecord({ status: 'failed', ciResult: 'failed', merged: false });
  };

  const handlePassedUnmerged = () => {
    onRecord({ status: 'passed_unmerged', ciResult: 'passed', merged: false });
  };

  const handleVerified = () => {
    setShowVerifiedConfirm(true);
  };

  const handleConfirmVerified = (ciResult: 'passed', merged: true) => {
    setShowVerifiedConfirm(false);
    onRecord({ status: 'verified', ciResult, merged });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
        Record investigation outcome
      </p>

      <button
        onClick={handleFailed}
        disabled={loading || status === 'failed'}
        className={`w-full py-3 px-4 border rounded-lg text-left font-medium transition-colors disabled:opacity-50 ${
          status === 'failed'
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-red-300 bg-white text-red-700 hover:bg-red-50'
        }`}
      >
        <div className="flex items-center justify-between">
          <span>CI still failed</span>
          {status === 'failed' && <CheckCircle2 className="w-4 h-4" />}
        </div>
        <p className="text-xs text-gray-500 mt-1">Mark this attempt as failed</p>
      </button>

      <button
        onClick={handlePassedUnmerged}
        disabled={loading || status === 'passed_unmerged'}
        className={`w-full py-3 px-4 border rounded-lg text-left font-medium transition-colors disabled:opacity-50 ${
          status === 'passed_unmerged'
            ? 'border-amber-200 bg-amber-50 text-amber-700'
            : 'border-amber-300 bg-white text-amber-700 hover:bg-amber-50'
        }`}
      >
        <div className="flex items-center justify-between">
          <span>CI passed, not merged</span>
          {status === 'passed_unmerged' && <CheckCircle2 className="w-4 h-4" />}
        </div>
        <p className="text-xs text-gray-500 mt-1">Fix passed CI but change not yet merged</p>
      </button>

      <button
        onClick={handleVerified}
        disabled={loading || status === 'verified'}
        className={`w-full py-3 px-4 border rounded-lg text-left font-medium transition-colors disabled:opacity-50 ${
          status === 'verified'
            ? 'border-green-200 bg-green-50 text-green-700'
            : 'border-green-300 bg-white text-green-700 hover:bg-green-50'
        }`}
      >
        <div className="flex items-center justify-between">
          <span>Verified (CI passed + merged)</span>
          {status === 'verified' && <CheckCircle2 className="w-4 h-4" />}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Requires explicit confirmation &mdash; saves to FlakeTrail memory
        </p>
      </button>

      {showVerifiedConfirm && (
        <VerifiedConfirmDialog
          onConfirm={handleConfirmVerified}
          onCancel={() => setShowVerifiedConfirm(false)}
          loading={loading}
        />
      )}

      {status && status !== 'proposed' && (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>Current outcome: <b>{status.replace(/_/g, ' ')}</b></span>
        </div>
      )}
    </div>
  );
}
