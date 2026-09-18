# @bedrockio/logger

Structured logger that targets both the console and remote cloud formats. This
includes:

- Pretty formatting for the console.
- Request logging [middleware](#middleware).
- Google Cloud structured logger.
- Request correlation of Google Cloud logs via trace headers.

## Install

```bash
yarn install @bedrockio/logger
```

## Usage

```js
const logger = require('@bedrockio/logger');
logger.setupGoogleCloud({
  // Set up gcloud structured logging. Default true.
  logging: true,
});
```

This initialization code should be added as early as possible in your
application.

### Tracing

No setup is needed to group logs by request. The [middleware](#request-context)
adds the trace id of the incoming request to every Google Cloud log written
while handling it, and Logs Explorer shows logs with the same trace id
together.

If your app also runs [OpenTelemetry](https://opentelemetry.io/), pass the
active span to the logger:

```js
const { trace } = require('@opentelemetry/api');
logger.setupGoogleCloud({
  getSpanContext: () => trace.getActiveSpan()?.spanContext(),
});
```

This is required for logs to show up in Cloud Trace:

- Logs use the span's trace id. Without it they use the trace id from the load
  balancer's `X-Cloud-Trace-Context` header, which OpenTelemetry does not read
  by default, so logs and spans end up in different traces.
- Logs are attached to the span that wrote them (`spanId`) and marked as sampled
  or not (`trace_sampled`).

When no span is active, logs fall back to the request's trace id.

## Log Levels

In development, setting `process.env.LOG_LEVEL` will set the log level which
silences lower level output:

- debug
- info
- warn
- error

The default is `info` which silences `debug` level logs.

### Methods

#### `logger.useConsole`

Sets the logger to use console output for development. This is the default.

#### `logger.useGoogleCloud`

Sets the logger to output structured logs in JSON format. Accepts an `options`
object:

- `getSpanContext` - Returns `{ traceId, spanId, traceFlags }` for the active
  span, or `undefined`. See [Tracing](#tracing).

### Logger Methods

```js
logger.debug('Hello');
logger.info('Hello');
logger.warn('Hello');
logger.error('Hello');
```

The basic methods will output logs at different levels.

### Object Logging

```js
logger.info({
  foo: 'bar',
});
```

Passing an object into the console logger will output it as you would see in the
`console`. When using the Google Cloud logger it will output a structured JSON
payload that allows inspecting of the object in the
[logging console](https://console.cloud.google.com/logs).

### Multiple Arguments

```js
logger.info('foo', 'bar');
logger.info(obj1, obj2);
```

Multiple arguments will be concatenated together in the console logger. The
Google Cloud logger will present a truncated message and export complex objects
to the JSON payload.

### String Formatting

```js
logger.info('%s -> %s', 'foo', 'bar'); // foo -> bar
```

Basic printf style formatting is supported out of the box by the console logger,
and the Google Cloud console will format basic tokens (`%s`, `%d`, and `%i`).
Note that decimal precision formatting such as `"%.2d"` is not supported.

#### `logger.middleware`

Koa middleware that logs HTTP requests:

```js
const Koa = require('koa');
const logger = require('@bedrockio/logging');

const app = new Koa();
app.use(logger.middleware());
```

### Request Context

The middleware runs each request in a context that is added to every Google
Cloud log written while handling it:

- `requestId` - A UUID generated for each request.
- `logging.googleapis.com/trace` - The trace id from the `traceparent` header,
  falling back to `X-Cloud-Trace-Context` set by Google Cloud HTTP load
  balancers. When neither arrives, for example behind a TCP load balancer, a
  trace id is generated. Logs Explorer groups logs of a request by it. Span ids
  in these headers belong to the caller and are not logged.

Register the middleware before other middleware so their logs are included.
`logger.getRequestContext()` returns the current context, or `undefined`
outside a request.

### Extra Fields

You can append custom fields to every log entry with `getExtraFields` — a
function that receives the Koa context and returns an object of fields to
include.

```js
app.use(logger.middleware({
  getExtraFields: (ctx) => ({
    organizationId: ctx.state?.organization?.id,
  }),
}));
```

Note: `getExtraFields` is ignored when `shouldLogVerbose` is active, as verbose
logging provides its own set of extra fields.

### Custom Log Level

By default, requests with status >= 500 are logged at `error` level and all
others at `info`. You can override this with the `getLogLevel` option — a
function that receives the Koa context and returns a log level string.

```js
app.use(logger.middleware({
  // Log 4xx responses as warnings.
  getLogLevel: (ctx) => {
    if (ctx.status >= 500) return 'error';
    if (ctx.status >= 400) return 'warn';
    return 'info';
  },
}));
```

If `getLogLevel` returns a falsy value, the default behavior is used.

### Verbose Request Logging

The logger middleware can record request body, query, and response body. This
is controlled by the `shouldLogVerbose` option — a function that receives the
Koa context and returns truthy to enable verbose logging for that request.

```js
app.use(logger.middleware({
  // Log verbose info for all error responses.
  shouldLogVerbose: (ctx) => ctx.status >= 400,
}));
```

```js
app.use(logger.middleware({
  // Log verbose info for a specific route.
  shouldLogVerbose: (ctx) => ctx.url.startsWith('/1/foo'),
}));
```

### Filtering Fields

By default, fields matching common sensitive names (`token`, `password`,
`secret`, `hash`, `jwt`) are automatically stripped from logged bodies and
queries. You can customize this with `allowedFields` (whitelist) and
`disallowedFields` (blacklist), which filter individual keys within each logged
object.

Each accepts a string, regex, array of strings/regexes, or a function that
receives the Koa context and returns any of the above.

```js
app.use(logger.middleware({
  shouldLogVerbose: (ctx) => ctx.status >= 400,
  // Only include specific fields in logged bodies.
  allowedFields: ['name', 'email', 'status'],
}));
```

```js
app.use(logger.middleware({
  shouldLogVerbose: (ctx) => ctx.status >= 400,
  // Exclude additional fields beyond the defaults.
  disallowedFields: /token|password|secret|hash|jwt|creditCard/i,
}));
```

```js
app.use(logger.middleware({
  shouldLogVerbose: (ctx) => true,
  // Use a function for dynamic filtering.
  allowedFields: (ctx) => {
    return ctx.method === 'GET' ? ['q', 'page'] : ['name', 'email'];
  },
}));
```
