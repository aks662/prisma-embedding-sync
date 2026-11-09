/** @file Creates Prisma test clients only after validating the dedicated test database URL. */
import { PrismaClient } from '@prisma/client';
import { getTestDatabaseUrl } from './db.js';
import { withEmbeddings } from '../../src/extension/index.js';
import type { EmbedConfig } from '../../src/types.js';

/** Creates an unextended Prisma client explicitly bound to the guarded test database. */
export function createTestClient() {
  const url = getTestDatabaseUrl();
  return new PrismaClient({
    datasources: { db: { url } },
    log: [{ emit: 'event', level: 'query' }],
  });
}

/** Creates the configured extended client while preserving its inferred Prisma extension type. */
export function createExtendedTestClient(client: PrismaClient, config: EmbedConfig) {
  return withEmbeddings(client, config);
}
