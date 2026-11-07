import { useState } from 'react';
import { Brain, AlertCircle, RefreshCw, X } from 'lucide-react';

interface ReflectNoticeProps {
  onReflect: () => Promise<void>;
  loading?: boolean;
}

export default function ReflectNotice({ onReflect, loading = false }: ReflectNoticeProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-shrink-0 w-5 h-5 text-amber-600 mt-0.5">
          <Brain aria-hidden="true" />
        </div>
        <div>
          <h3 className="font-semibold text-amber-800 mb-1">Optional: Hindsight REFLECT</h3>
          <p className="text-amber-700 leading-relaxed">
            Running REFLECT will re-analyze this failure using Hindsight memory and consume a{' '}
            <b>paid Hindsight operation</b>. It is not part of normal analysis and is entirely optional.
          </p>
        </div>
      </div>

      <button
        onClick={onReflect}
        disabled={loading}
        className="w-full py-2.5 rounded-lg border border-amber-300 bg-amber-100 text-amber-800 font-medium hover:bg-amber-200 disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" /> Running REFLECT...
          </>
        ) : (
          <>
            <Brain className="w-4 h-4" /> Run Hindsight REFLECT (paid operation)
          </>
        )}
      </button>

      <button
        onClick={() => setDismissed(true)}
        className="mt-3 text-xs text-amber-600 hover:underline focus:outline-none"
      >
        <X className="w-3 h-3 mr-1" aria-hidden="true" /> Dismiss
      </button>
    </section>
  );
}
