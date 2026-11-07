import { ParsedFailure } from '../../../shared/src/index';
import { FileText, Code, GitBranch, CircleHelp, Copy } from 'lucide-react';

interface ErrorSummaryProps {
  failure: ParsedFailure;
}

export default function ErrorSummary({ failure }: ErrorSummaryProps) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-5 h-5 text-blue-600" />
        <h2 className="text-lg font-semibold text-gray-900">Detected failure</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Test</p>
          <p className="font-mono text-sm text-gray-900 break-all">{failure.testName}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">CI job</p>
          <p className="font-mono text-sm text-gray-900 break-all">
            {failure.ciJobId || 'N/A'}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Branch</p>
          <p className="font-mono text-sm text-gray-900 break-all">
            {failure.ciBranch || 'N/A'}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center gap-2 mb-2">
          <CircleHelp className="w-4 h-4 text-gray-400" aria-hidden="true" />
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Error message</p>
        </div>
        <p className="font-mono text-sm text-gray-800 break-all bg-gray-50 p-3 rounded border border-gray-100">
          {failure.errorMessage}
        </p>
      </div>

      <div className="mt-6">
        <div className="flex items-center gap-2 mb-2">
          <Code className="w-4 h-4 text-gray-400" aria-hidden="true" />
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Failure signature</p>
        </div>
        <div className="flex items-center gap-2">
          <p className="font-mono text-xs text-gray-800 break-all bg-gray-50 p-3 rounded border border-gray-100 flex-1">
            {failure.failureSignature}
          </p>
          <button
            className="rounded hover:bg-gray-100 text-gray-500 p-1.5 focus:outline-none"
            title="Copy failure signature"
            aria-label="Copy failure signature"
          >
            <Copy className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      </div>

      {(failure.stackTrace || failure.rawLogExcerpt) && (
        <details className="mt-6 group">
          <summary className="flex items-center gap-2 cursor-pointer text-sm font-medium text-blue-600 hover:text-blue-800">
            <CircleHelp className="w-3 h-3 shrink-0" aria-hidden="true" />
            View raw log excerpt (redacted)
          </summary>
          <div className="mt-3 bg-gray-900 text-gray-300 font-mono text-xs p-4 rounded overflow-x-auto break-all max-h-64 overflow-y-auto">
            {failure.stackTrace ?? failure.rawLogExcerpt}
          </div>
        </details>
      )}
    </section>
  );
}
