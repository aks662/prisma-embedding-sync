/** @file Protects integration tests and destructive fixture cleanup with a test-database identity guard. */
import type { PrismaClient } from '@prisma/client';

const TEST_DATABASE_NAME = 'prisma_embedding_sync_test';
const ALLOWED_TEST_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

/** Returns DATABASE_URL only after confirming it names the dedicated local test database. */
export function getTestDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!isDedicatedTestDatabaseUrl(value)) {
    throw new Error(
      `Refusing database access: DATABASE_URL must target the dedicated ${TEST_DATABASE_NAME} database on a local/test host`,
    );
  }
  return value;
}

/** Checks URL protocol, database name, user, and host without revealing credentials. */
export function isDedicatedTestDatabaseUrl(value: string | undefined): value is string {
  if (value === undefined) {
    return false;
  }

  try {
    const url = new URL(value);
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const username = decodeURIComponent(url.username);
    return (
      (url.protocol === 'postgresql:' || url.protocol === 'postgres:') &&
      databaseName === TEST_DATABASE_NAME &&
      username === 'postgres' &&
      ALLOWED_TEST_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Confirms the connected server is the dedicated database and has pgvector installed. */
export async function verifyTestDatabase(client: PrismaClient): Promise<void> {
  getTestDatabaseUrl();
  const rows = await client.$queryRaw<Array<{ databaseName: string; vectorEnabled: boolean }>>`
    SELECT
      current_database() AS "databaseName",
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS "vectorEnabled"
  `;
  const identity = rows[0];
  if (identity?.databaseName !== TEST_DATABASE_NAME || identity.vectorEnabled !== true) {
    throw new Error(
      `Refusing database operation: expected ${TEST_DATABASE_NAME} with pgvector enabled`,
    );
  }
}

/** Clears only the protected test Product table before an integration test. */
export async function resetTestDatabase(client: PrismaClient): Promise<void> {
  await verifyTestDatabase(client);
  await client.$executeRaw`TRUNCATE TABLE "Product" RESTART IDENTITY CASCADE`;
}
