import consoleAsync from '../utils/async-console';
import { isTTY } from '../utils/env';
import { getRequestContext } from '../utils/request-context';

import BaseLogger from './BaseLogger';

// Note: GCP severity levels are described here:
// https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
// For the purposes of common logging the following are used:
// - DEBUG
// - INFO
// - WARNING
// - ERROR

const SEVERITY_MAP = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
};

export default class GoogleCloudLogger extends BaseLogger {
  debug(...args) {
    return this.emit('DEBUG', ...args);
  }

  info(...args) {
    return this.emit('INFO', ...args);
  }

  warn(...args) {
    return this.emit('WARNING', ...args);
  }

  error(...args) {
    return this.emit('ERROR', ...args);
  }

  emit(severity, ...args) {
    const message = this.getMessage(args);

    this.emitPayload({
      ...this.getPayloadForArgs(args),
      context: this.options.context,
      severity,
      message,
    });
  }

  formatRequest(info) {
    // https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry
    let {
      size,
      path,
      level,
      method,
      latency,
      status,
      referer,
      remoteIp,
      serverIp,
      protocol,
      userAgent,
      requestLength,
      responseLength,
      ...rest
    } = info;
    const severity = SEVERITY_MAP[level] || 'INFO';
    const message = `${method} ${path} ${size} - ${latency}ms`;

    this.emitPayload({
      ...rest,
      message,
      severity,
      httpRequest: {
        requestMethod: method,
        requestUrl: path,
        requestSize: info.requestLength?.toString(),
        responseSize: info.responseLength?.toString(),
        status,
        referer,
        remoteIp,
        serverIp,
        protocol,
        userAgent,
        latency: `${latency / 1000}s`,
      },
    });
  }

  emitPayload(payload) {
    // Fields the caller logged take precedence over request fields.
    payload = {
      ...this.getRequestPayload(),
      ...payload,
    };
    let str;
    try {
      str = JSON.stringify(payload);
    } catch (err) {
      if (!(err instanceof TypeError)) {
        throw err;
      }
      str = err.message.includes('circular')
        ? '[Cyclic Object]'
        : '[Unserializable Object]';
    }
    log(str);
  }

  getRequestPayload() {
    const request = getRequestContext();
    const span = this.options.getSpanContext?.();
    const traceId = span?.traceId || request?.traceId;
    return {
      requestId: request?.requestId,
      ...(traceId && {
        'logging.googleapis.com/trace': traceId,
      }),
      ...(span && {
        'logging.googleapis.com/spanId': span.spanId,
        'logging.googleapis.com/trace_sampled': (span.traceFlags & 1) === 1,
      }),
    };
  }

  getPayloadForArgs(args) {
    const result = {};
    for (let arg of args) {
      if (typeof arg !== 'object' || Array.isArray(arg)) {
        continue;
      }

      if (arg.toJSON) {
        arg = arg.toJSON();
      }

      if (arg instanceof Error) {
        Object.assign(result, {
          ...arg,
          name: arg.name,
          message: arg.message,
          // Note this is a special field that will expose the stack trace to Cloud Error Reporting.
          // https://docs.cloud.google.com/error-reporting/docs/formatting-error-messages#log-error
          stack_trace: arg.stack,
        });
      } else {
        Object.assign(result, arg);
      }
    }

    return result;
  }
}

// Wrap this to allow testing.
function log(msg) {
  const console = isTTY ? global.console : consoleAsync;
  console.log(msg);
}
