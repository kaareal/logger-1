import {
  trace,
  debug,
  info,
  warn,
  error,
  formatRequest,
  useConsole,
  useFormatted,
  useGoogleCloud,
} from './logger';
import { isTTY, isCloudEnv } from './utils/env';
import middleware from './middleware';
import { getRequestContext } from './utils/request-context';

/**
 * @param {Object} [options]
 * @param {boolean} [options.logging=true]
 * @param {() => import('./utils/request-context').SpanContext|undefined} [options.getSpanContext]
 *   Returns the active span, e.g. from OpenTelemetry. Takes precedence over
 *   trace headers read by the middleware.
 */
function setupGoogleCloud(options = {}) {
  const { logging = true, getSpanContext } = options;
  if (logging) {
    useGoogleCloud({
      getSpanContext,
    });
  }
}

if (isCloudEnv() && !isTTY) {
  setupGoogleCloud();
} else {
  useFormatted();
}

export {
  trace,
  debug,
  info,
  warn,
  error,
  formatRequest,
  middleware,
  useConsole,
  useFormatted,
  useGoogleCloud,
  setupGoogleCloud,
  getRequestContext,
};

export default {
  trace,
  debug,
  info,
  warn,
  error,
  formatRequest,
  middleware,
  useConsole,
  useFormatted,
  useGoogleCloud,
  setupGoogleCloud,
  getRequestContext,
};
