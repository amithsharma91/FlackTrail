import { ParsedFailure } from '../../../shared/src/index';

interface ErrorSummaryProps {
  failure: ParsedFailure;
}

export default function ErrorSummary({ failure }: ErrorSummaryProps) {
  return (
    <div className="p-4 bg-gray-50 rounded-lg">
      <h3 className="text-sm font-medium text-gray-900 mb-2">Error details</h3>
      <p className="text-xs text-gray-500 mb-1">Test: {failure.testName}</p>
      <p className="text-xs text-gray-500 mb-1">Message: {failure.errorMessage}</p>
    </div>
  );
}
