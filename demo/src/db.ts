/** @file Creates a guarded Prisma client with the demo's embedding synchronization config. */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { OllamaProvider, withEmbeddings, type EmbeddingProvider } from 'prisma-embedding-sync';

const DEMO_DATABASE_NAME = 'prisma_embedding_sync_demo';
const DEMO_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Creates an extended client only when DATABASE_URL points at the dedicated local demo DB. */
export function createDemoPrismaClient(provider: EmbeddingProvider = new OllamaProvider()) {
  const url = getDemoDatabaseUrl();
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  return client.$extends(
    withEmbeddings({
      models: {
        Product: {
          sourceFields: ['name', 'description'],
          targetField: 'embedding',
          hashField: 'embeddingHash',
          provider,
          dimensions: 768,
        },
      },
    }),
  );
}

/** Generated extended-client type used by the demo routes and local API smoke test. */
export type DemoPrismaClient = ReturnType<typeof createDemoPrismaClient>;

/** Returns a local demo URL after verifying its database identity and host. */
export function getDemoDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (value === undefined) {
    throw new Error('DATABASE_URL is required; see demo/.env.example');
  }
  try {
    const url = new URL(value);
    const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (
      !['postgresql:', 'postgres:'].includes(url.protocol) ||
      name !== DEMO_DATABASE_NAME ||
      url.port !== '5433' ||
      url.searchParams.get('schema') !== 'public' ||
      url.searchParams.getAll('schema').length !== 1 ||
      [...url.searchParams.keys()].some((key) => key !== 'schema') ||
      url.hash !== '' ||
      url.username !== 'postgres' ||
      !DEMO_DATABASE_HOSTS.has(url.hostname)
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      `Refusing database access: DATABASE_URL must target the local ${DEMO_DATABASE_NAME} database on port 5433 with schema public`,
    );
  }
  return value;
}
