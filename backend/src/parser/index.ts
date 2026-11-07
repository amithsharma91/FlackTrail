import { createHmac } from 'crypto';
import {
  ParsedFailure,
  HistoricalInvestigation,
  AIAnalysis,
  AnalyzeResponse,
} from '../shared/index';

export function redactSecrets(text: string): string {
  if (!text) return '';

  let redacted = text;

  // Redact Authorization headers
  redacted = redacted.replace(/Authorization:\s*Bearer\s+\S+/gi, 'Authorization: [REDACTED]');
  redacted = redacted.replace(/Authorization:\s*\S+/gi, 'Authorization: [REDACTED]');

  // Redact API keys (sk-, API_KEY=, etc.)
  redacted = redacted.replace(/sk-[A-Za-z0-9-]{20,}/g, '[REDACTED_API_KEY]');
  redacted = redacted.replace(/(API_KEY\s*[:=]\s*)\S+/gi, '$1[REDACTED]');
  redacted = redacted.replace(/(token\s*[:=]\s*)\S+/gi, '$1[REDACTED]');
  redacted = redacted.replace(/(access_token\s*[:=]\s*)\S+/gi, '$1[REDACTED]');

  // Redact passwords
  redacted = redacted.replace(/(password\s*[:=]\s*)\S+/gi, '$1[REDACTED]');
  redacted = redacted.replace(/(pass\s*[:=]\s*)\S+/gi, '$1[REDACTED]');
  redacted = redacted.replace(/(pwd\s*[:=]\s*)\S+/gi, '$1[REDACTED]');

  // Redact GitHub tokens
  redacted = redacted.replace(/ghp_[A-Za-z0-9]{36}/g, '[REDACTED_GITHUB_TOKEN]');
  redacted = redacted.replace(/glpat-[A-Za-z0-9\-]{20,}/g, '[REDACTED_GITLAB_TOKEN]');

  // Redact private keys
  redacted = redacted.replace(
    /-----BEGIN (RSA |EC |DSA |ENCRYPTED PRIVATE KEY|PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
    '-----BEGIN [REDACTED_PRIVATE_KEY]-----'
  );

  // Redact connection strings with credentials
  redacted = redacted.replace(
    /(mongodb|postgres|mysql|redis|amqp):\/\/[^:\s]+:[^@\s]+@/gi,
    '$1://[REDACTED_USER]:[REDACTED_PASS]@'
  );

  return redacted;
}

export function generateFailureSignature(
  testName: string,
  errorMessage: string
): string {
  const normalizedError = errorMessage
    .toLowerCase()
    .replace(/\d+/g, 'N')
    .replace(/[^a-z0-9\s]/gi, '')
    .trim()
    .replace(/\s+/g, ' ')
    .substring(0, 100);

  const combined = `${testName}:${normalizedError}`;
  return createHmac('sha256', combined).digest('hex').substring(0, 16);
}

export function parseCILog(
  logText: string,
  fileName?: string
): ParsedFailure {
  if (!logText || logText.trim().length === 0) {
    throw new Error('CI log text is empty');
  }

  const redactedLog = redactSecrets(logText);

  // Extract test name - look for common patterns
  let testName = 'unknown';
  const testMatch = redactedLog.match(
    /(?:FAILED|FAIL|PASSED|ERROR|Error)\s+[\w:.]*::?(\w[\w.]*)/i
  );
  if (testMatch) {
    testName = testMatch[1];
  } else {
    // Try pytest-style: test_*.py::test_name
    const pytestMatch = redactedLog.match(/::(\w[\w.]*)/);
    if (pytestMatch) {
      testName = pytestMatch[1];
    }
  }

  // Extract error message
  let errorMessage = 'Unknown error';
  const errorMatch = redactedLog.match(
    /(?:Error|error|FAILED|failed|Exception|exception):\s*(.+)/i
  );
  if (errorMatch) {
    errorMessage = errorMatch[1].trim().substring(0, 500);
  } else {
    // Take first non-empty line as error
    const lines = redactedLog.split('\n').filter((l) => l.trim());
    if (lines.length > 0) {
      errorMessage = lines[0].trim().substring(0, 500);
    }
  }

  // Extract error type
  let errorType: string | undefined;
  const typeMatch = redactedLog.match(/(\w+(?:Error|Exception|Failure|Panic))/);
  if (typeMatch) {
    errorType = typeMatch[1];
  }

  // Extract stack trace
  let stackTrace: string | undefined;
  const stackMatch = redactedLog.match(
    /(?:Traceback|Stack trace|at\s)[\s\S]{10,}/i
  );
  if (stackMatch) {
    stackTrace = stackMatch[0].substring(0, 2000);
  }

  // Extract file paths
  const filePaths: string[] = [];
  const fileMatches = redactedLog.match(/[\w\/\\-]+\.\w{2,4}/g);
  if (fileMatches) {
    const uniqueFiles = [...new Set(fileMatches)];
    filePaths.push(...uniqueFiles.slice(0, 10));
  }

  // Extract CI job info
  let ciJobId: string | undefined;
  let ciBranch: string | undefined;
  const jobMatch = redactedLog.match(/build[-\s]?(\d+)/i);
  if (jobMatch) {
    ciJobId = `build-${jobMatch[1]}`;
  }
  const branchMatch = redactedLog.match(/(?:branch|on)\s+(\S+)/i);
  if (branchMatch) {
    ciBranch = branchMatch[1];
  }

  const failureSignature = generateFailureSignature(testName, errorMessage);

  return {
    testName,
    errorMessage,
    errorType,
    stackTrace,
    failureSignature,
    environment: {},
    filePaths: filePaths.length > 0 ? filePaths : undefined,
    ciJobId,
    ciBranch,
    rawLogExcerpt: redactedLog.substring(0, 2000),
  };
}
