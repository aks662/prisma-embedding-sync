/** @file Reproduces pgvector persistence and Prisma transaction-boundary behavior against PostgreSQL. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient } from './helpers/client.js';
import { isDedicatedTestDatabaseUrl, resetTestDatabase, verifyTestDatabase } from './helpers/db.js';
import { findProduct, seedProduct } from './helpers/seed.js';

describe('dedicated database guard', () => {
  it('accepts only the explicitly named local PostgreSQL test database', () => {
    expect(
      isDedicatedTestDatabaseUrl(
        'postgresql://postgres:test@localhost:5432/prisma_embedding_sync_test?schema=public',
      ),
    ).toBe(true);
    expect(
      isDedicatedTestDatabaseUrl(
        'postgresql://postgres:test@postgres:5432/prisma_embedding_sync_test?schema=public',
      ),
    ).toBe(true);
  });

  it('rejects unset, personal/default, remote, non-PostgreSQL, and non-test-user URLs', () => {
    expect(isDedicatedTestDatabaseUrl(undefined)).toBe(false);
    expect(isDedicatedTestDatabaseUrl('postgresql://postgres:test@localhost:5432/postgres')).toBe(
      false,
    );
    expect(
      isDedicatedTestDatabaseUrl(
        'postgresql://postgres:test@db.example.com:5432/prisma_embedding_sync_test',
      ),
    ).toBe(false);
    expect(
      isDedicatedTestDatabaseUrl('mysql://postgres:test@localhost/prisma_embedding_sync_test'),
    ).toBe(false);
    expect(
      isDedicatedTestDatabaseUrl(
        'postgresql://test_user:test@localhost:5432/prisma_embedding_sync_test',
      ),
    ).toBe(false);
  });
});

const dbIntegration = describe.skipIf(process.env.DB_INTEGRATION !== '1');

dbIntegration('pgvector persistence and transaction architecture', () => {
  let client: ReturnType<typeof createTestClient>;
  const queryEvents: string[] = [];

  beforeAll(async () => {
    client = createTestClient();
    client.$on('query', (event) => queryEvents.push(event.query));
    await verifyTestDatabase(client);
  });

  beforeEach(async () => {
    await resetTestDatabase(client);
  });

  afterAll(async () => {
    if (client !== undefined) {
      await resetTestDatabase(client);
      await client.$disconnect();
    }
  });

  it('persists ordinary fields, hash, and Unsupported vector in one raw INSERT statement', async () => {
    const row = await seedProduct(client, {
      name: 'raw vector insert',
      description: 'one statement contains every persisted field',
      price: '19.50',
      embedding: [0.1, 0.2, 0.3],
      embeddingHash: 'raw-hash',
    });

    expect(row.name).toBe('raw vector insert');
    expect(row.embedding).toBe('[0.1,0.2,0.3]');
    expect(row.embeddingHash).toBe('raw-hash');
  });

  it('uses a PostgreSQL trigger to persist a Prisma-writable staged vector in the create mutation', async () => {
    const firstQueryIndex = queryEvents.length;
    const product = await client.product.create({
      data: {
        name: 'trigger vector insert',
        description: 'Prisma writes ordinary fields and text vector input together',
        price: '22.00',
        embeddingHash: 'trigger-hash',
        embeddingInput: '[0.4,0.5,0.6]',
      },
    });
    const persisted = await findProduct(client, product.id);
    const [input] = await client.$queryRaw<Array<{ embeddingInput: string | null }>>`
      SELECT "embeddingInput" FROM "Product" WHERE "id" = ${product.id}
    `;

    expect(persisted?.embedding).toBe('[0.4,0.5,0.6]');
    expect(persisted?.embeddingHash).toBe('trigger-hash');
    expect(input?.embeddingInput).toBeNull();
    expect(product.embeddingInput).toBeNull();
    const productInserts = queryEvents
      .slice(firstQueryIndex)
      .filter((query) => /^\s*INSERT\s+INTO\s+.*"Product"/i.test(query));
    expect(productInserts).toHaveLength(1);
  });

  it('does not leave ordinary fields, vector, or hash after an invalid staged vector fails', async () => {
    await expect(
      client.product.create({
        data: {
          name: 'invalid vector rollback',
          description: 'wrong vector dimensions',
          price: '14.00',
          embeddingHash: 'must-not-persist',
          embeddingInput: '[0.1,0.2]',
        },
      }),
    ).rejects.toThrow();

    const rows = await client.product.findMany({ where: { name: 'invalid vector rollback' } });
    expect(rows).toHaveLength(0);
  });

  it('rolls back a trigger-backed create and vector inside an interactive transaction', async () => {
    await expect(
      client.$transaction(async (tx) => {
        await tx.product.create({
          data: {
            name: 'interactive rollback',
            description: 'will roll back',
            price: '10.00',
            embeddingHash: 'rollback-hash',
            embeddingInput: '[0.1,0.2,0.3]',
          },
        });
        throw new Error('force interactive rollback');
      }),
    ).rejects.toThrow('force interactive rollback');

    const rows = await client.product.findMany({ where: { name: 'interactive rollback' } });
    expect(rows).toHaveLength(0);
  });

  it('rolls back all writes in a batch transaction when a later statement fails', async () => {
    const create = client.product.create({
      data: {
        name: 'batch rollback',
        description: 'will roll back',
        price: '11.00',
        embeddingHash: 'batch-hash',
        embeddingInput: '[0.2,0.3,0.4]',
      },
    });
    const conflictingInsert = client.$executeRaw`
      INSERT INTO "Product" ("id", "name", "description", "price")
      VALUES (999999, 'duplicate', 'forced failure', 1.00)
    `;
    const duplicateFailure = client.$executeRaw`
      INSERT INTO "Product" ("id", "name", "description", "price")
      VALUES (999999, 'duplicate again', 'forced failure', 1.00)
    `;

    await expect(
      client.$transaction([create, conflictingInsert, duplicateFailure]),
    ).rejects.toThrow();
    const rows = await client.product.findMany({
      where: { name: { in: ['batch rollback', 'duplicate', 'duplicate again'] } },
    });
    expect(rows).toHaveLength(0);
  });

  it('shows a captured base-client raw INSERT escaping an interactive transaction rollback', async () => {
    const extended = capturedRawSqlExtension(client, 'captured interactive raw');
    await expect(
      extended.$transaction(async (tx) => {
        await tx.product.create({
          data: {
            name: 'interactive query row',
            description: 'belongs to caller transaction',
            price: '12.00',
          },
        });
        throw new Error('force outer rollback');
      }),
    ).rejects.toThrow('force outer rollback');

    const products = await client.product.findMany({
      where: { name: { in: ['captured interactive raw', 'interactive query row'] } },
    });
    expect(products.map((product) => product.name)).toEqual(['captured interactive raw']);
    const [captured] = await client.$queryRaw<Array<{ embedding: string | null }>>`
      SELECT "embedding"::text AS "embedding"
      FROM "Product" WHERE "name" = 'captured interactive raw'
    `;
    expect(captured?.embedding).toBe('[0.7,0.8,0.9]');
  });

  it('shows a captured base-client raw INSERT escaping a batch transaction rollback', async () => {
    const extended = capturedRawSqlExtension(client, 'captured batch raw');
    const create = extended.product.create({
      data: {
        name: 'batch query row',
        description: 'belongs to batch transaction',
        price: '13.00',
      },
    });
    const conflictingInsert = client.$executeRaw`
      INSERT INTO "Product" ("id", "name", "description", "price")
      VALUES (999998, 'duplicate batch', 'forced failure', 1.00)
    `;
    const duplicateFailure = client.$executeRaw`
      INSERT INTO "Product" ("id", "name", "description", "price")
      VALUES (999998, 'duplicate batch again', 'forced failure', 1.00)
    `;

    await expect(
      extended.$transaction([create, conflictingInsert, duplicateFailure]),
    ).rejects.toThrow();
    const products = await client.product.findMany({
      where: {
        name: {
          in: ['captured batch raw', 'batch query row', 'duplicate batch', 'duplicate batch again'],
        },
      },
    });
    expect(products.map((product) => product.name)).toEqual(['captured batch raw']);
  });
});

function capturedRawSqlExtension(client: ReturnType<typeof createTestClient>, rawName: string) {
  return client.$extends({
    name: 'captured-raw-sql-transaction-probe',
    query: {
      product: {
        async create({ args, query }) {
          await client.$executeRaw`
            INSERT INTO "Product" ("name", "description", "price", "embedding", "embeddingHash")
            VALUES (${rawName}, 'written through captured client', 7.00, '[0.7,0.8,0.9]'::vector(3), 'captured-hash')
          `;
          return query(args);
        },
      },
    },
  });
}
