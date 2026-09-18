import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';

/**
 * @typedef {Object} SpanContext
 * @property {string} traceId 32 character hex trace id.
 * @property {string} [spanId] 16 character hex span id.
 * @property {number} [traceFlags] W3C trace flags. Bit 1 marks the trace as sampled.
 */

/**
 * @typedef {Object} RequestContext
 * @property {string} requestId
 * @property {string} traceId From the request's trace headers, or generated.
 */

const storage = new AsyncLocalStorage();

const TRACEPARENT_REG = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/i;
const CLOUD_TRACE_REG = /^([\da-f]{32})(?:\/\d+)?(?:;o=[01])?$/i;
const INVALID_TRACE_REG = /^0+$/;

/**
 * Returns the context of the request currently handled by the middleware,
 * or undefined outside of a request.
 *
 * @returns {RequestContext|undefined}
 */
export function getRequestContext() {
  return storage.getStore();
}

export function runWithRequestContext(context, fn) {
  return storage.run(context, fn);
}

export function bindRequestContext(fn) {
  const context = storage.getStore();
  return (...args) => storage.run(context, fn, ...args);
}

/**
 * @param {Object} headers
 * @returns {RequestContext}
 */
export function createRequestContext(headers) {
  return {
    requestId: randomUUID(),
    // Generated when no header arrives, e.g. behind an L4 load balancer.
    traceId: parseTraceId(headers) || randomBytes(16).toString('hex'),
  };
}

/**
 * Reads the trace id from the W3C `traceparent` header, falling back to the
 * `X-Cloud-Trace-Context` header set by Google Cloud load balancers. The span
 * ids in these headers belong to the caller, so they are not used.
 *
 * @param {Object} headers
 * @returns {string|undefined}
 */
export function parseTraceId(headers) {
  return (
    matchTraceId(headers['traceparent'], TRACEPARENT_REG) ||
    matchTraceId(headers['x-cloud-trace-context'], CLOUD_TRACE_REG)
  );
}

export function isValidTraceId(traceId) {
  return !!traceId && !INVALID_TRACE_REG.test(traceId);
}

function matchTraceId(header, reg) {
  const traceId = header?.match(reg)?.[1].toLowerCase();
  if (isValidTraceId(traceId)) {
    return traceId;
  }
}
