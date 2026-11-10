/** @file Builds and starts the isolated local Express demo server. */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import express, { type Express, type RequestHandler } from 'express';
import { OllamaProvider, type EmbeddingProvider } from 'prisma-embedding-sync';
import { createDemoPrismaClient, type DemoPrismaClient } from './db.js';
import { createProductRouter } from './routes/products.js';

/** Options for constructing an app instance, including test provider/client injection. */
export interface DemoAppOptions {
  client?: DemoPrismaClient;
  provider?: EmbeddingProvider;
}

/** Creates the demo HTTP app without listening, suitable for local serving and smoke tests. */
export function createDemoApp(options: DemoAppOptions = {}): Express {
  const provider = options.provider ?? new OllamaProvider();
  const client = options.client ?? createDemoPrismaClient(provider);
  const app = express();
  const webDirectory = fileURLToPath(new URL('../web/', import.meta.url));

  app.disable('x-powered-by');
  const writeRateLimiter = createRateLimiter(10, 15 * 60_000);
  const searchRateLimiter = createRateLimiter(20, 60_000);
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    next();
  });
  app.use(['/healthz', '/products', '/search'], createRateLimiter(120, 60_000));
  app.use('/products', (request, response, next) => {
    if (request.method === 'POST' || request.method === 'PATCH') {
      writeRateLimiter(request, response, next);
      return;
    }
    next();
  });
  app.use('/search', searchRateLimiter);
  app.use(express.json({ limit: '16kb' }));
  app.get('/healthz', async (_request, response, next): Promise<void> => {
    try {
      await client.$queryRaw<Array<{ ready: number }>>`SELECT 1 AS ready`;
      response.json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  });
  app.use(createProductRouter(client, provider));
  app.use(express.static(webDirectory));
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      if (response.headersSent) {
        process.stderr.write('Demo response failed after headers were sent; details redacted.\n');
        next(error);
        return;
      }
      if (hasErrorType(error, 'entity.too.large')) {
        response.status(413).json({ error: 'request body is too large' });
        return;
      }
      if (hasErrorType(error, 'entity.parse.failed')) {
        response.status(400).json({ error: 'request body must be valid JSON' });
        return;
      }
      process.stderr.write('Demo request failed; details redacted.\n');
      response.status(500).json({ error: 'internal server error' });
    },
  );
  return app;
}

function hasErrorType(error: unknown, type: string): boolean {
  return typeof error === 'object' && error !== null && 'type' in error && error.type === type;
}

function createRateLimiter(limit: number, windowMs: number): RequestHandler {
  const counters = new Map<string, { count: number; resetAt: number }>();
  const maxTrackedClients = 4_096;
  let nextCleanupAt = 0;

  return (request, response, next): void => {
    const now = Date.now();
    if (now >= nextCleanupAt) {
      for (const [address, counter] of counters) {
        if (counter.resetAt <= now) {
          counters.delete(address);
        }
      }
      nextCleanupAt = now + windowMs;
    }

    // Use the socket address directly; forwarded headers are not trusted by this local demo.
    const address = request.socket.remoteAddress ?? 'unknown';
    const current = counters.get(address);
    if (current !== undefined && current.resetAt > now && current.count >= limit) {
      response.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1_000)));
      response.status(429).json({ error: 'too many requests; retry later' });
      return;
    }

    if (current === undefined || current.resetAt <= now) {
      if (!counters.has(address) && counters.size >= maxTrackedClients) {
        response.setHeader('Retry-After', String(Math.ceil(windowMs / 1_000)));
        response.status(503).json({ error: 'request capacity temporarily unavailable' });
        return;
      }
      counters.set(address, { count: 1, resetAt: now + windowMs });
    } else {
      current.count += 1;
    }
    next();
  };
}

/** Starts the demo on the configured port or the documented default 3001. */
export function startDemoServer(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The local demo cannot start in production mode');
  }
  const port = Number(process.env.PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError('PORT must be an integer between 1 and 65535');
  }
  const provider = new OllamaProvider();
  const client = createDemoPrismaClient(provider);
  const server = createDemoApp({ client, provider }).listen(port, '127.0.0.1', () => {
    process.stdout.write(`Demo listening at http://localhost:${port}\n`);
  });
  const shutdown = (): void => {
    void closeDemoServer(server, client).catch(() => {
      process.stderr.write('Demo shutdown failed while closing the server or database client.\n');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function closeDemoServer(
  server: ReturnType<Express['listen']>,
  client: DemoPrismaClient,
): Promise<void> {
  let closeError: Error | undefined;
  await new Promise<void>((resolve) => {
    server.close((error) => {
      closeError = error ?? undefined;
      resolve();
    });
  });
  await client.$disconnect();
  if (closeError !== undefined) {
    throw closeError;
  }
}

const invokedFile = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedFile !== undefined && fileURLToPath(import.meta.url) === invokedFile) {
  startDemoServer();
}
