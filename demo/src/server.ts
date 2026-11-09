/** @file Builds and starts the isolated local Express demo server. */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import express, { type Express } from 'express';
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

  app.use(express.json());
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
        next(error);
        return;
      }
      const message = error instanceof Error ? error.message : 'request failed';
      response.status(500).json({ error: message });
    },
  );
  return app;
}

/** Starts the demo on the configured port or the documented default 3001. */
export function startDemoServer(): void {
  const port = Number(process.env.PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError('PORT must be an integer between 1 and 65535');
  }
  createDemoApp().listen(port, '127.0.0.1', () => {
    process.stdout.write(`Demo listening at http://localhost:${port}\n`);
  });
}

const invokedFile = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedFile !== undefined && fileURLToPath(import.meta.url) === invokedFile) {
  startDemoServer();
}
