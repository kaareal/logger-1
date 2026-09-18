import { mockConsole, unmockConsole, getMessages } from './mocks/console';
import { info, useFormatted, useGoogleCloud } from '../src/logger';
import middleware from '../src/middleware';

jest.useFakeTimers().setSystemTime(new Date('2020-01-01'));

beforeEach(() => {
  mockConsole();
});

afterAll(() => {
  unmockConsole();
});

function createContext(obj) {
  let onFinish;
  return {
    ...obj,
    res: {
      once(event, fn) {
        if (event === 'finish') {
          onFinish = fn;
        }
      },
      end() {
        onFinish?.();
      },
    },
    request: {
      ...obj.request,
      headers: {
        ...obj.request?.headers,
      },
    },
    response: {
      ...obj.response,
      headers: {
        ...obj.response?.headers,
      },
    },
  };
}

function runRequest(ctx, config) {
  middleware(config)(ctx, () => {
    jest.advanceTimersByTime(100);
  });
  ctx.res.end();
}

function assertBodyRecorded(expected) {
  const [level, message] = getMessages()[0];
  expect(level).toBe('log');
  const parsed = JSON.parse(message);
  if (expected) {
    expect(parsed).toMatchObject({
      requestBody: expected,
    });
  } else {
    expect(parsed).not.toHaveProperty('requestBody');
  }
}

function assertQueryRecorded(expected) {
  const [level, message] = getMessages()[0];
  expect(level).toBe('log');
  const parsed = JSON.parse(message);
  if (expected) {
    expect(parsed).toMatchObject({
      requestQuery: expected,
    });
  } else {
    expect(parsed).not.toHaveProperty('requestQuery');
  }
}

describe('formatted middleware', () => {
  beforeAll(() => {
    useFormatted();
  });

  it('should log a request', () => {
    const ctx = createContext({
      url: '/foo',
      method: 'POST',
      status: 200,
      response: {
        headers: {
          'content-length': '2048',
        },
      },
    });
    middleware()(ctx, () => {
      jest.advanceTimersByTime(100);
    });
    ctx.res.end();
    expect(getMessages()).toEqual([
      ['info', '[2020-01-01T00:00:00]  INFO POST   200 /foo 100ms 2KB'],
    ]);
  });

  it('should ignore GCE health checks', () => {
    const ctx = createContext({
      url: '/foo',
      method: 'POST',
      status: 200,
      request: {
        headers: {
          'user-agent': 'GoogleHC/1.0',
        },
      },
    });
    middleware()(ctx, () => {});
    ctx.res.end();
    expect(getMessages()).toEqual([]);
  });

  it('should ignore kubernetes health checks', () => {
    const ctx = createContext({
      url: '/foo',
      method: 'POST',
      status: 200,
      request: {
        headers: {
          'user-agent': 'kube-probe/1.26',
        },
      },
    });
    middleware()(ctx, () => {});
    ctx.res.end();
    expect(getMessages()).toEqual([]);
  });

  it('should ignoring custom headers by string', () => {
    const options = {
      ignoreUserAgents: ['Foobar'],
    };
    const ctx = createContext({
      url: '/foo',
      method: 'POST',
      status: 200,
      request: {
        headers: {
          'user-agent': 'Foobar',
        },
      },
    });
    middleware(options)(ctx, () => {});
    ctx.res.end();
    expect(getMessages()).toEqual([]);
  });

  it('should ignoring custom headers by regex', () => {
    const options = {
      ignoreUserAgents: [/^foo/i],
    };
    const ctx = createContext({
      url: '/foo',
      method: 'POST',
      status: 200,
      request: {
        headers: {
          'user-agent': 'Foobar',
        },
      },
    });
    middleware(options)(ctx, () => {});
    ctx.res.end();
    expect(getMessages()).toEqual([]);
  });
});

describe('google cloud middleware', () => {
  beforeAll(() => {
    useGoogleCloud();
  });

  it('should log a request', () => {
    const ctx = createContext({
      url: '/foo',
      method: 'POST',
      status: 200,
      response: {
        headers: {
          'content-length': '2048',
        },
      },
    });
    middleware()(ctx, () => {
      jest.advanceTimersByTime(100);
    });
    ctx.res.end();
    const [level, message] = getMessages()[0];
    expect(level).toBe('log');
    expect(JSON.parse(message)).toEqual({
      message: 'POST /foo 2KB - 100ms',
      severity: 'INFO',
      requestId: expect.any(String),
      'logging.googleapis.com/trace': expect.stringMatching(/^[\da-f]{32}$/),
      httpRequest: {
        latency: '0.1s',
        requestMethod: 'POST',
        requestUrl: '/foo',
        responseSize: '2048',
        status: 200,
      },
    });
  });

  it('should add a userId in labels for an authenticated user', () => {
    const ctx = createContext({
      url: '/foo',
      method: 'POST',
      status: 200,
      state: {
        authUser: {
          id: 'fake-id',
        },
      },
      response: {
        headers: {
          'content-length': '2048',
        },
      },
    });
    middleware()(ctx, () => {
      jest.advanceTimersByTime(100);
    });
    ctx.res.end();
    const [level, message] = getMessages()[0];
    expect(level).toBe('log');
    expect(JSON.parse(message)).toEqual({
      message: 'POST /foo 2KB - 100ms',
      severity: 'INFO',
      userId: 'fake-id',
      requestId: expect.any(String),
      'logging.googleapis.com/trace': expect.stringMatching(/^[\da-f]{32}$/),
      httpRequest: {
        latency: '0.1s',
        requestMethod: 'POST',
        requestUrl: '/foo',
        responseSize: '2048',
        status: 200,
      },
    });
  });

  it('should ignore GCE health checks', () => {
    const ctx = createContext({
      url: '/foo',
      method: 'POST',
      status: 200,
      request: {
        headers: {
          'user-agent': 'GoogleHC/1.0',
        },
      },
    });
    middleware()(ctx, () => {});
    ctx.res.end();
    expect(getMessages()).toEqual([]);
  });

  it('should ignore kubernetes health checks', () => {
    const ctx = createContext({
      url: '/foo',
      method: 'POST',
      status: 200,
      request: {
        headers: {
          'user-agent': 'kube-probe/1.26',
        },
      },
    });
    middleware()(ctx, () => {});
    ctx.res.end();
    expect(getMessages()).toEqual([]);
  });

  describe('request context', () => {
    const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

    function createTracedContext() {
      return createContext({
        url: '/foo',
        method: 'GET',
        status: 200,
        request: {
          headers: {
            traceparent: `00-${TRACE_ID}-00f067aa0ba902b7-01`,
          },
        },
      });
    }

    const TRACE_FIELDS = {
      requestId: expect.any(String),
      'logging.googleapis.com/trace': TRACE_ID,
    };

    it('should add trace fields to the request log', () => {
      const ctx = createTracedContext();
      middleware()(ctx, () => {});
      ctx.res.end();
      const [, message] = getMessages()[0];
      const parsed = JSON.parse(message);
      expect(parsed).toMatchObject(TRACE_FIELDS);
      expect(parsed).not.toHaveProperty('logging.googleapis.com/spanId');
    });

    it('should add trace fields to logs inside async handlers', async () => {
      const ctx = createTracedContext();
      await middleware()(ctx, async () => {
        await Promise.resolve();
        info('inside');
      });
      const [, message] = getMessages()[0];
      expect(JSON.parse(message)).toMatchObject({
        message: 'inside',
        ...TRACE_FIELDS,
      });
    });

    it('should read the X-Cloud-Trace-Context header from Google load balancers', () => {
      const ctx = createContext({
        url: '/foo',
        method: 'GET',
        status: 200,
        request: {
          headers: {
            'x-cloud-trace-context': `${TRACE_ID}/12345;o=1`,
          },
        },
      });
      middleware()(ctx, () => {});
      ctx.res.end();
      const [, message] = getMessages()[0];
      expect(JSON.parse(message)).toMatchObject(TRACE_FIELDS);
    });

    it('should not add fields to logs outside a request', () => {
      info('outside');
      const [, message] = getMessages()[0];
      expect(JSON.parse(message)).toEqual({
        message: 'outside',
        severity: 'INFO',
      });
    });
  });

  describe('custom log level', () => {
    it('should default to info for status < 500', () => {
      const ctx = createContext({
        url: '/foo',
        method: 'GET',
        status: 200,
      });
      runRequest(ctx);
      const [, message] = getMessages()[0];
      expect(JSON.parse(message)).toMatchObject({
        severity: 'INFO',
      });
    });

    it('should default to error for status >= 500', () => {
      const ctx = createContext({
        url: '/foo',
        method: 'GET',
        status: 500,
      });
      runRequest(ctx);
      const [, message] = getMessages()[0];
      expect(JSON.parse(message)).toMatchObject({
        severity: 'ERROR',
      });
    });

    it('should use getLogLevel when provided', () => {
      const ctx = createContext({
        url: '/foo',
        method: 'GET',
        status: 200,
      });
      runRequest(ctx, {
        getLogLevel: () => 'warn',
      });
      const [, message] = getMessages()[0];
      expect(JSON.parse(message)).toMatchObject({
        severity: 'WARNING',
      });
    });

    it('should pass context to getLogLevel', () => {
      const getLogLevel = jest.fn(() => 'debug');
      const ctx = createContext({
        url: '/foo',
        method: 'GET',
        status: 200,
      });
      runRequest(ctx, { getLogLevel });
      expect(getLogLevel).toHaveBeenCalledWith(ctx);
    });

    it('should fall back to default when getLogLevel returns falsy', () => {
      const ctx = createContext({
        url: '/foo',
        method: 'GET',
        status: 500,
      });
      runRequest(ctx, {
        getLogLevel: () => null,
      });
      const [, message] = getMessages()[0];
      expect(JSON.parse(message)).toMatchObject({
        severity: 'ERROR',
      });
    });
  });

  describe('verbose request logging', () => {
    it('should not record anything by default', () => {
      const ctx = createContext({
        status: 400,
        request: {
          body: {
            bar: 'baz',
          },
        },
      });
      runRequest(ctx);
      assertBodyRecorded(null);
    });

    it('should throw if shouldLogVerbose is not a function', () => {
      expect(() => {
        middleware({ shouldLogVerbose: true });
      }).toThrow('Argument must be a function.');
    });

    it('should record request body when shouldLogVerbose returns true', () => {
      const ctx = createContext({
        status: 400,
        request: {
          body: {
            bar: 'baz',
          },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
      });
      assertBodyRecorded({
        bar: 'baz',
      });
    });

    it('should record request query when shouldLogVerbose returns true', () => {
      const ctx = createContext({
        url: '/foo',
        method: 'GET',
        status: 400,
        request: {
          query: {
            bar: 'baz',
          },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
      });
      assertQueryRecorded({
        bar: 'baz',
      });
    });

    it('should not record when shouldLogVerbose returns false', () => {
      const ctx = createContext({
        status: 400,
        request: {
          body: {
            bar: 'baz',
          },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => false,
      });
      assertBodyRecorded(null);
    });

    it('should pass context to shouldLogVerbose', () => {
      const shouldLogVerbose = jest.fn(() => true);
      const ctx = createContext({
        url: '/foo',
        status: 400,
        request: {
          body: {
            bar: 'baz',
          },
        },
      });
      runRequest(ctx, { shouldLogVerbose });
      expect(shouldLogVerbose).toHaveBeenCalledWith(ctx);
    });

    it('should conditionally log based on context', () => {
      const ctx = createContext({
        url: '/foo',
        status: 200,
        request: {
          body: {
            bar: 'baz',
          },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: (ctx) => ctx.status >= 400,
      });
      assertBodyRecorded(null);
    });

    it('should strip sensitive fields by default', () => {
      const ctx = createContext({
        status: 400,
        request: {
          body: {
            name: 'test',
            password: 'BAD',
            token: 'BAD',
            secret: 'BAD',
            hash: 'BAD',
            jwt: 'BAD',
          },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
      });
      assertBodyRecorded({
        name: 'test',
      });
    });

    it('should filter with allowedFields as a string', () => {
      const ctx = createContext({
        status: 400,
        request: {
          body: { bar: 'baz', other: 'value' },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
        allowedFields: 'bar',
        disallowedFields: [],
      });
      assertBodyRecorded({ bar: 'baz' });
    });

    it('should filter with allowedFields as an array', () => {
      const ctx = createContext({
        status: 400,
        request: {
          body: { bar: 'baz', other: 'value', extra: 'data' },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
        allowedFields: ['bar', 'other'],
        disallowedFields: [],
      });
      assertBodyRecorded({ bar: 'baz', other: 'value' });
    });

    it('should filter with allowedFields as a regex', () => {
      const ctx = createContext({
        status: 400,
        request: {
          body: { fooName: 'a', fooValue: 'b', other: 'c' },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
        allowedFields: /^foo/,
        disallowedFields: [],
      });
      assertBodyRecorded({ fooName: 'a', fooValue: 'b' });
    });

    it('should filter with allowedFields as a function', () => {
      const ctx = createContext({
        url: '/foo',
        status: 400,
        request: {
          body: { bar: 'baz', other: 'value' },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
        allowedFields: (ctx) => {
          return ctx.url === '/foo' ? ['bar'] : [];
        },
        disallowedFields: [],
      });
      assertBodyRecorded({ bar: 'baz' });
    });

    it('should filter with disallowedFields as a string', () => {
      const ctx = createContext({
        status: 400,
        request: {
          body: { bar: 'baz', secret: 'BAD' },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
        disallowedFields: 'secret',
      });
      assertBodyRecorded({ bar: 'baz' });
    });

    it('should filter with disallowedFields as an array', () => {
      const ctx = createContext({
        status: 400,
        request: {
          body: { bar: 'baz', bad1: 'x', bad2: 'y' },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
        disallowedFields: ['bad1', 'bad2'],
      });
      assertBodyRecorded({ bar: 'baz' });
    });

    it('should filter with disallowedFields as a regex', () => {
      const ctx = createContext({
        status: 400,
        request: {
          body: { bar: 'baz', mySecret: 'x', myToken: 'y' },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
        disallowedFields: /secret|token/i,
      });
      assertBodyRecorded({ bar: 'baz' });
    });

    it('should filter with disallowedFields as a function', () => {
      const ctx = createContext({
        url: '/foo',
        status: 400,
        request: {
          body: { bar: 'baz', internal: 'hidden' },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
        disallowedFields: (ctx) => {
          return ctx.url === '/foo' ? ['internal'] : [];
        },
      });
      assertBodyRecorded({ bar: 'baz' });
    });

    it('should apply both allowedFields and disallowedFields', () => {
      const ctx = createContext({
        status: 400,
        request: {
          body: { bar: 'baz', other: 'value', bad: 'x' },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
        allowedFields: ['bar', 'bad'],
        disallowedFields: ['bad'],
      });
      assertBodyRecorded({ bar: 'baz' });
    });

    it('should not log binary request body', () => {
      const ctx = createContext({
        status: 200,
        request: {
          body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
      });
      const [level, message] = getMessages()[0];
      expect(level).toBe('log');
      const parsed = JSON.parse(message);
      expect(parsed).not.toHaveProperty('requestBody');
    });

    it('should throw when verbose log exceeds 256KB', () => {
      const ctx = createContext({
        status: 400,
        request: {
          body: {
            name: 'test',
            payload: new Array(256 * 1024).fill('a'),
          },
        },
      });
      expect(() => {
        runRequest(ctx, {
          shouldLogVerbose: () => true,
        });
      }).toThrow('Maximum log size exceeded.');
    });

    it('should apply filters to query params as well', () => {
      const ctx = createContext({
        status: 400,
        request: {
          query: { q: 'search', token: 'BAD' },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
      });
      assertQueryRecorded({ q: 'search' });
    });
  });

  describe('extra fields', () => {
    it('should throw if getExtraFields is not a function', () => {
      expect(() => {
        middleware({ getExtraFields: true });
      }).toThrow('Argument must be a function.');
    });

    it('should append extra fields to the log', () => {
      const ctx = createContext({
        url: '/foo',
        method: 'POST',
        status: 200,
      });
      runRequest(ctx, {
        getExtraFields: () => ({ customField: 'hello' }),
      });
      const [, message] = getMessages()[0];
      expect(JSON.parse(message)).toMatchObject({
        customField: 'hello',
      });
    });

    it('should pass context to getExtraFields', () => {
      const getExtraFields = jest.fn(() => ({}));
      const ctx = createContext({
        url: '/foo',
        method: 'POST',
        status: 200,
      });
      runRequest(ctx, { getExtraFields });
      expect(getExtraFields).toHaveBeenCalledWith(ctx);
    });

    it('should not append extra fields when shouldLogVerbose is active', () => {
      const ctx = createContext({
        status: 400,
        request: {
          body: { bar: 'baz' },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
        getExtraFields: () => ({ customField: 'hello' }),
      });
      const [, message] = getMessages()[0];
      const parsed = JSON.parse(message);
      assertBodyRecorded({ bar: 'baz' });
      expect(parsed).not.toHaveProperty('customField');
    });

    it('should handle getExtraFields returning undefined', () => {
      const ctx = createContext({
        url: '/foo',
        method: 'POST',
        status: 200,
      });
      runRequest(ctx, {
        getExtraFields: () => undefined,
      });
      expect(getMessages().length).toBe(1);
    });

    it('should truncate long fields', () => {
      const ctx = createContext({
        status: 400,
        request: {
          body: { foo: 'a'.repeat(1000) },
        },
      });
      runRequest(ctx, {
        shouldLogVerbose: () => true,
      });
      assertBodyRecorded({
        foo: `${'a'.repeat(500)}... [TRUNCATED]`,
      });
    });
  });
});
