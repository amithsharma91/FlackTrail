import { describe, test, expect } from 'vitest';
import { parseCILog, redactSecrets } from '../backend/src/parser';

describe('CI Parser', () => {
  test('extracts test name and error message from a Python pytest failure', () => {
    const log = `FAILED payments/service_test.py::test_payment_retry - Error: timeout after 30s waiting for payment gateway mock`;
    const result = parseCILog(log);
    expect(result.testName).toBe('test_payment_retry');
    expect(result.errorMessage).toContain('timeout after 30s');
    expect(result.failureSignature).toBeDefined();
    expect(result.failureSignature.length).toBeGreaterThan(0);
  });

  test('extracts test name from Jest failure', () => {
    const log = `FAIL src/__tests__/api.test.js › payment › retry payment when gateway times out`;
    const result = parseCILog(log);
    expect(result.testName).toBeDefined();
    expect(result.failureSignature).toBeDefined();
  });

  test('handles empty log gracefully', () => {
    expect(() => parseCILog('')).toThrow();
    expect(() => parseCILog('   ')).toThrow();
  });

  test('produces consistent failure signature for same error', () => {
    const log1 = `FAILED test_payment_retry - Error: timeout after 30s waiting for payment gateway mock`;
    const log2 = `FAILED test_payment_retry - Error: timeout after 30s waiting for payment gateway mock`;
    const sig1 = parseCILog(log1).failureSignature;
    const sig2 = parseCILog(log2).failureSignature;
    expect(sig1).toBe(sig2);
  });

  test('extracts test name from "FAIL: test_name" colon-separated format', () => {
    const log = `FAIL: test_user_login
Error: Database connection timeout`;
    const result = parseCILog(log);
    expect(result.testName).toBe('test_user_login');
    expect(result.ciBranch).toBeUndefined();
  });

  test('extracts test name from "PASSED test_foo" format', () => {
    const result = parseCILog('PASSED test_foo');
    expect(result.testName).toBe('test_foo');
  });

  test('does not set testName from an Error line', () => {
    const result = parseCILog('Error: Database connection timeout');
    expect(result.testName).toBe('unknown');
  });

  test('does not treat common English words after "on" as ciBranch', () => {
    expect(parseCILog('FAILED test_foo - Error: something on timeout').ciBranch).toBeUndefined();
    expect(parseCILog('FAILED test_foo - Error: something on error').ciBranch).toBeUndefined();
    expect(parseCILog('FAILED test_foo - Error: something on failed').ciBranch).toBeUndefined();
    expect(parseCILog('FAILED test_foo - Error: connection timeout').ciBranch).toBeUndefined();
  });

  test('extracts a real ciBranch from "on <branch>" and "branch <branch>"', () => {
    expect(parseCILog('FAILED test_foo - Error: x\non main').ciBranch).toBe('main');
    expect(parseCILog('FAILED test_foo - Error: x\nbranch feature/login').ciBranch).toBe('feature/login');
  });
});

describe('Secret Redaction', () => {
  test('redacts API keys', () => {
    const text = 'API_KEY=sk-1234567890abcdef';
    const result = redactSecrets(text);
    expect(result).not.toContain('sk-1234567890abcdef');
    expect(result).toContain('[REDACTED]');
  });

  test('redacts Authorization headers', () => {
    const text = 'Authorization: Bearer ghp_abcdef123456';
    const result = redactSecrets(text);
    expect(result).not.toContain('ghp_abcdef123456');
    expect(result).toContain('[REDACTED]');
  });

  test('redacts passwords', () => {
    const text = 'password=secret123';
    const result = redactSecrets(text);
    expect(result).not.toContain('secret123');
    expect(result).toContain('[REDACTED]');
  });

  test('redacts private keys', () => {
    const text = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----';
    const result = redactSecrets(text);
    expect(result).not.toContain('MIIEvQIBADAN');
    expect(result).toContain('[REDACTED_PRIVATE_KEY]');
  });

  test('redacts connection strings with credentials', () => {
    const text = 'mongodb://user:pass@host:27017/db';
    const result = redactSecrets(text);
    expect(result).not.toContain('user:pass@');
    expect(result).toContain('[REDACTED_USER]');
  });

  test('preserves useful debugging context', () => {
    const text = 'FAILED test_payment_retry - Error: timeout after 30s waiting for payment gateway mock at payments/mock_gateway.py:42';
    const result = redactSecrets(text);
    expect(result).toContain('test_payment_retry');
    expect(result).toContain('timeout after 30s');
    expect(result).toContain('payments/mock_gateway.py');
  });
});

describe('CI Parser - Edge Cases', () => {
  test('handles malformed CI log without throwing', () => {
    const log = 'random garbage output that is not a real CI failure';
    const result = parseCILog(log);
    expect(result.testName).toBeDefined();
    expect(result.failureSignature).toBeDefined();
    expect(result.failureSignature.length).toBeGreaterThan(0);
  });

  test('handles log with missing stack trace', () => {
    const log = 'FAILED test_suite::test_login - Error: invalid credentials';
    const result = parseCILog(log);
    expect(result.testName).toBe('test_login');
    expect(result.errorMessage).toContain('invalid credentials');
    expect(result.stackTrace).toBeUndefined();
    expect(result.failureSignature).toBeDefined();
  });

  test('handles large log without errors and truncates error message', () => {
    const noisyLine = 'x'.repeat(2000);
    const log = `FAILED test_suite::test_big - Error: real timeout issue\n${noisyLine}\n${noisyLine}\n`;
    const result = parseCILog(log);
    expect(result.testName).toBe('test_big');
    expect(result.errorMessage.length).toBeLessThanOrEqual(500);
    expect(result.failureSignature).toBeDefined();
    expect(result.rawLogExcerpt.length).toBeLessThanOrEqual(2000);
  });

  test('failure signature is stable across whitespace-only differences', () => {
    const log1 = 'FAILED test_payment_retry - Error: timeout after 30s';
    const log2 = 'FAILED test_payment_retry  -  Error: timeout after 30s';
    expect(parseCILog(log1).failureSignature).toBe(parseCILog(log2).failureSignature);
  });
});
