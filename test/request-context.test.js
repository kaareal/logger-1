import { parseTraceId, createRequestContext } from '../src/utils/request-context';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

describe('parseTraceId', () => {
  it('should read traceparent', () => {
    expect(
      parseTraceId({
        traceparent: `00-${TRACE_ID}-00f067aa0ba902b7-01`,
      }),
    ).toBe(TRACE_ID);
  });

  it('should read X-Cloud-Trace-Context', () => {
    expect(
      parseTraceId({
        'x-cloud-trace-context': `${TRACE_ID}/1;o=1`,
      }),
    ).toBe(TRACE_ID);
  });

  it('should read X-Cloud-Trace-Context without span or options', () => {
    expect(
      parseTraceId({
        'x-cloud-trace-context': TRACE_ID,
      }),
    ).toBe(TRACE_ID);
  });

  it('should prefer traceparent', () => {
    expect(
      parseTraceId({
        traceparent: `00-${TRACE_ID}-00f067aa0ba902b7-00`,
        'x-cloud-trace-context': 'a'.repeat(32),
      }),
    ).toBe(TRACE_ID);
  });

  it('should lowercase the trace id', () => {
    expect(
      parseTraceId({
        'x-cloud-trace-context': TRACE_ID.toUpperCase(),
      }),
    ).toBe(TRACE_ID);
  });

  it('should fall back to X-Cloud-Trace-Context when traceparent is malformed', () => {
    expect(
      parseTraceId({
        traceparent: 'garbage',
        'x-cloud-trace-context': `${TRACE_ID}/1;o=1`,
      }),
    ).toBe(TRACE_ID);
  });

  it('should fall back to X-Cloud-Trace-Context when traceparent has an all-zero trace id', () => {
    expect(
      parseTraceId({
        traceparent: `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`,
        'x-cloud-trace-context': `${TRACE_ID}/1;o=1`,
      }),
    ).toBe(TRACE_ID);
  });

  it('should ignore malformed headers', () => {
    expect(
      parseTraceId({
        traceparent: 'garbage',
        'x-cloud-trace-context': 'also-garbage',
      }),
    ).toBeUndefined();
  });

  it('should return undefined without headers', () => {
    expect(parseTraceId({})).toBeUndefined();
  });
});

describe('createRequestContext', () => {
  it('should use x-request-id when present', () => {
    expect(
      createRequestContext({
        'x-request-id': 'abc',
        traceparent: `00-${TRACE_ID}-00f067aa0ba902b7-01`,
      }),
    ).toEqual({
      requestId: 'abc',
      traceId: TRACE_ID,
    });
  });

  it('should generate a request id', () => {
    const { requestId } = createRequestContext({});
    expect(requestId).toMatch(/^[\da-f-]{36}$/);
  });
});
