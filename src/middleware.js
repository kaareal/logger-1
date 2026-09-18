import bytes from 'bytes';

import { formatRequest } from './logger';
import {
  bindRequestContext,
  createRequestContext,
  runWithRequestContext,
} from './utils/request-context';

const IGNORE_UA_REG = /^(GoogleHC|kube-probe)/;

/**
 * @param {MiddlewareOptions} [options]
 */
export default function middleware(options) {
  assertOptions(options);
  return (ctx, next) => {
    const context = createRequestContext(ctx.request.headers);
    return runWithRequestContext(context, () => {
      if (isAllowedRequest(ctx, options)) {
        const start = new Date();
        // Event listeners run in the emitter's async context, so bind the request's.
        ctx.res.once(
          'finish',
          bindRequestContext(() => {
            formatRequest({
              ...getRequestInfo(ctx, options),
              ...getRequestExtra(ctx, options),
              // @ts-ignore
              latency: new Date() - start,
            });
          }),
        );
      }
      return next();
    });
  };
}

function assertOptions(options = {}) {
  const { getExtraFields, shouldLogVerbose } = options;

  assertFunction(getExtraFields);
  assertFunction(shouldLogVerbose);
}

function assertFunction(arg) {
  if (arg && typeof arg !== 'function') {
    throw new Error('Argument must be a function.');
  }
}

function isAllowedRequest(ctx, options = {}) {
  const { ignoreUserAgents = [IGNORE_UA_REG] } = options;
  const ua = ctx.request.headers['user-agent'] || '';
  return ignoreUserAgents.some((test) => {
    return !ua.match(test);
  });
}

function getRequestInfo(ctx, options) {
  const { headers } = ctx.request;
  const level = getLogLevel(ctx, options);
  const requestLength = ctx.request.headers['content-length'];
  const responseLength = ctx.response.headers['content-length'];
  const size = bytes(Number(responseLength || 0));
  const userId = ctx.state?.authUser?.id;

  const referer = headers['referer'];
  const userAgent = headers['user-agent'];
  const protocol = headers['x-forwarded-proto'] || ctx.protocol;
  const remoteIp = headers['x-forwarded-for'];
  const serverIp = ctx.ip;

  return {
    level,
    userId,
    url: ctx.href,
    path: ctx.url,
    method: ctx.method,
    status: ctx.status,
    requestLength,
    responseLength,
    referer,
    remoteIp,
    serverIp,
    protocol,
    userAgent,
    size,
  };
}

function getLogLevel(ctx, options = {}) {
  const { getLogLevel } = options;

  let level = getLogLevel?.(ctx);
  level ||= ctx.status >= 500 ? 'error' : 'info';

  return level;
}

const BLACKLIST = /token|password|secret|hash|jwt/i;

function getRequestExtra(ctx, options = {}) {
  const { getExtraFields, shouldLogVerbose } = options;

  let extra;

  if (shouldLogVerbose?.(ctx)) {
    extra = {
      requestBody: applyFilters(ctx, ctx.request.body, options),
      requestQuery: applyFilters(ctx, ctx.request.query, options),
      responseBody: applyFilters(ctx, ctx.response.body, options),
    };
  } else {
    extra = getExtraFields?.(ctx);
  }

  if (extra) {
    assertMaxBytes(extra);
  }

  return extra || {};
}

const MAX_BYTES = 200_000;

function assertMaxBytes(obj) {
  const bytes = Buffer.byteLength(JSON.stringify(obj), 'utf8');
  if (bytes > MAX_BYTES) {
    throw new Error('Maximum log size exceeded.');
  }
}

function applyFilters(ctx, obj, options) {
  if (!isSerializable(obj)) {
    return;
  }

  const { allowedFields, disallowedFields = BLACKLIST } = options;

  const allowed = resolveFields(ctx, allowedFields);
  const disallowed = resolveFields(ctx, disallowedFields);

  if (allowed.length) {
    obj = pick(obj, allowed);
  }

  if (disallowed.length) {
    obj = omit(obj, disallowed);
  }

  if (Object.keys(obj).length) {
    return truncateStrings(obj);
  }
}

function isSerializable(obj) {
  return obj?.constructor === Object || Array.isArray(obj);
}

function resolveFields(ctx, arg) {
  let resolved = arg;
  if (typeof resolved === 'function') {
    resolved = resolved(ctx);
  }
  if (!Array.isArray(resolved)) {
    resolved = resolved ? [resolved] : [];
  }
  return resolved;
}

/**
 * @typedef {Object} MiddlewareOptions
 * @property {(ctx: Object) => Object} [getExtraFields] Function that receives the
 *   Koa context and returns an object of extra fields to append to the log entry.
 *   Ignored when shouldLogVerbose is active.
 * @property {(ctx: Object) => any} [shouldLogVerbose] Function that receives the
 *   Koa context and returns truthy to enable verbose logging (request body, query,
 *   response body) for that request.
 * @property {FieldFilter} [allowedFields] Whitelist of field names within each
 *   logged object (request body, query, response body). When set, only matching
 *   fields are kept.
 * @property {FieldFilter} [disallowedFields] Blacklist of field names within each
 *   logged object. Defaults to a regex matching sensitive names like token,
 *   password, secret, hash, and jwt.
 * @property {(ctx: Object) => string} [getLogLevel] Function that receives the
 *   Koa context and returns a log level string (e.g. 'info', 'warn', 'error').
 *   Falls back to 'error' for status >= 500, otherwise 'info'.
 * @property {(RegExp|string)[]} [ignoreUserAgents] User-Agent patterns to ignore.
 *   Defaults to GCE and Kubernetes health check agents.
 */

/**
 * @typedef {string | RegExp | (string|RegExp)[] | ((ctx: Object) => (string|RegExp)[])} FieldFilter
 */

function pick(obj, arr) {
  return filter(obj, arr, true);
}

function omit(obj, arr) {
  return filter(obj, arr, false);
}

function filter(obj, arr, allow) {
  const result = {};
  for (let key of Object.keys(obj)) {
    let match = false;
    for (let el of arr) {
      if (el instanceof RegExp) {
        match = el.test(key);
      } else {
        match = el === key;
      }
      if (match) {
        break;
      }
    }
    if (match === allow) {
      result[key] = obj[key];
    }
  }
  return result;
}

const TRUNCATE_LIMIT = 500;

function truncateStrings(arg) {
  if (Array.isArray(arg)) {
    return arg.map(truncateStrings);
  } else if (isObject(arg)) {
    const result = {};
    for (let [key, value] of Object.entries(arg)) {
      result[key] = truncateStrings(value);
    }
    return result;
  } else if (typeof arg === 'string') {
    if (arg.length > TRUNCATE_LIMIT) {
      arg = `${arg.slice(0, 500)}... [TRUNCATED]`;
    }
  }
  return arg;
}

function isObject(arg) {
  return arg && Object.getPrototypeOf(arg) === Object.prototype;
}
