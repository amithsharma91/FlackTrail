export const sampleIncidents = [
  {
    id: 'sample-1',
    testName: 'test_payment_retry',
    errorMessage: 'timeout after 30s waiting for payment gateway mock',
    failureSignature: 'sample-sig-001',
    status: 'failed' as const,
    attemptedFix: 'Increase timeout from 30s to 60s',
    ciJobId: 'build-4021',
    ciBranch: 'main',
    timestamp: '2026-11-01T10:00:00Z',
    source: 'sample-1',
    labels: ['demo', 'failed-attempt'],
  },
  {
    id: 'sample-2',
    testName: 'test_payment_retry',
    errorMessage: 'timeout after 30s waiting for payment gateway mock',
    failureSignature: 'sample-sig-001',
    status: 'verified' as const,
    attemptedFix: 'Reset payment mock state between tests',
    ciJobId: 'build-4022',
    ciBranch: 'main',
    prLink: 'https://github.com/amithsharma91/FlackTrail/pull/3342',
    timestamp: '2026-11-02T14:30:00Z',
    source: 'sample-2',
    labels: ['demo', 'verified-fix'],
  },
  {
    id: 'sample-3',
    testName: 'test_refund_retry',
    errorMessage: 'timeout after 30s waiting for payment gateway mock',
    failureSignature: 'sample-sig-001',
    status: 'proposed' as const,
    ciJobId: 'build-4189',
    ciBranch: 'main',
    timestamp: '2026-11-03T09:15:00Z',
    source: 'sample-3',
    labels: ['demo', 'new-failure'],
  },
];

export const sampleCiLog = `FAILED payments/service_test.py::test_payment_retry
Error: timeout after 30s waiting for payment gateway mock
  File "payments/mock_gateway.py", line 42, in wait_for_response
    raise TimeoutError("timeout after 30s waiting for payment gateway mock")
TimeoutError: timeout after 30s waiting for payment gateway mock`;

export const sampleCiLogWithSecrets = `FAILED payments/service_test.py::test_payment_retry
Error: timeout after 30s waiting for payment gateway mock
API_KEY=sk-live-abcdef1234567890
Authorization: Bearer ghp_abcdef1234567890
  File "payments/mock_gateway.py", line 42, in wait_for_response
    raise TimeoutError("timeout after 30s waiting for payment gateway mock")
TimeoutError: timeout after 30s waiting for payment gateway mock`;
