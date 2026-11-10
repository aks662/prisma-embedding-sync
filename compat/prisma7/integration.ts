/** @file Verifies the packed extension against Prisma 7 and isolated PostgreSQL/pgvector. */
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';
import { MockProvider, UnsupportedOperationError, withEmbeddings } from 'prisma-embedding-sync';

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, 'DATABASE_URL is required');
const database = new URL(databaseUrl);
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '5434');
assert.equal(database.pathname, '/prisma_embedding_sync_test_v7');

const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const provider = new MockProvider({ dimensions: 3 });
const db = raw.$extends(
  withEmbeddings({
    models: {
      Product: {
        sourceFields: ['name', 'description'],
        targetField: 'embedding',
        provider,
        dimensions: 3,
      },
    },
  }),
);

type StoredProduct = {
  embedding: string | null;
  embeddingHash: string | null;
  embeddingInput: string | null;
};

async function readStoredProduct(id: number): Promise<StoredProduct | undefined> {
  const rows = await raw.$queryRaw<StoredProduct[]>`
    SELECT "embedding"::text AS "embedding", "embeddingHash", "embeddingInput"
    FROM "Product" WHERE "id" = ${id}
  `;
  return rows[0];
}

async function verifyIntegration(): Promise<void> {
  const identity = await raw.$queryRaw<Array<{ databaseName: string; vectorEnabled: boolean }>>`
    SELECT current_database() AS "databaseName",
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS "vectorEnabled"
  `;
  assert.deepEqual(identity[0], {
    databaseName: 'prisma_embedding_sync_test_v7',
    vectorEnabled: true,
  });
  await raw.product.deleteMany();

  const created = await db.product.create({
    data: { id: 7301, name: 'Keyboard', description: 'wireless', price: '49.00' },
  });
  assert.equal(provider.embedCallCount, 1);
  assert.equal(created.embeddingInput, null);
  const initial = await readStoredProduct(created.id);
  assert.ok(initial?.embedding);
  assert.ok(initial?.embeddingHash);
  assert.equal(initial?.embeddingInput, null);

  await db.product.update({ where: { id: created.id }, data: { price: '55.00' } });
  assert.equal(provider.embedCallCount, 1);
  const priceOnly = await readStoredProduct(created.id);
  assert.equal(priceOnly?.embedding, initial?.embedding);
  assert.equal(priceOnly?.embeddingHash, initial?.embeddingHash);

  await db.product.update({
    where: { id: created.id, embeddingHash: created.embeddingHash },
    data: { name: 'Keyboard', description: 'mechanical wireless' },
  });
  assert.equal(provider.embedCallCount, 2);
  const descriptionChanged = await readStoredProduct(created.id);
  assert.notEqual(descriptionChanged?.embedding, priceOnly?.embedding);
  assert.notEqual(descriptionChanged?.embeddingHash, priceOnly?.embeddingHash);
  assert.equal(descriptionChanged?.embeddingInput, null);

  const bulk = await db.product.createMany({
    data: [
      { id: 7302, name: 'Mouse', description: 'ergonomic', price: '20.00' },
      { id: 7303, name: 'Monitor', description: 'wide display', price: '200.00' },
    ],
  });
  assert.equal(bulk.count, 2);
  assert.equal(provider.embedCallCount, 4);
  assert.ok((await readStoredProduct(7302))?.embedding);
  assert.ok((await readStoredProduct(7303))?.embedding);

  const upserted = await db.product.upsert({
    where: { id: 7304 },
    create: {
      id: 7304,
      name: 'Headphones',
      description: 'noise cancelling',
      price: '80.00',
    },
    update: { price: '81.00' },
  });
  assert.equal(provider.embedCallCount, 5);
  assert.equal((await readStoredProduct(upserted.id))?.embeddingInput, null);
  await db.product.upsert({
    where: { id: 7304 },
    create: {
      id: 7304,
      name: 'Headphones',
      description: 'noise cancelling',
      price: '80.00',
    },
    update: { price: '82.00' },
  });
  assert.equal(provider.embedCallCount, 6);

  const beforeBulkUpdate = await raw.product.findUniqueOrThrow({ where: { id: 7301 } });
  await assert.rejects(
    db.product.updateMany({ where: { id: 7301 }, data: { price: '60.00' } }),
    UnsupportedOperationError,
  );
  const afterBulkUpdate = await raw.product.findUniqueOrThrow({ where: { id: 7301 } });
  assert.equal(afterBulkUpdate.price.toString(), beforeBulkUpdate.price.toString());
  assert.equal(provider.embedCallCount, 6);

  provider.failNextWith = new Error('provider transaction rollback probe');
  await assert.rejects(
    db.$transaction((transaction) =>
      transaction.product.create({
        data: {
          id: 7399,
          name: 'Rollback',
          description: 'provider failure',
          price: '1.00',
        },
      }),
    ),
    /provider transaction rollback probe/,
  );
  assert.equal(await raw.product.findUnique({ where: { id: 7399 } }), null);
  assert.equal(await raw.product.count(), 4);
  process.stdout.write(
    'Prisma 7 pgvector integration passed: create, updates, createMany, upsert, updateMany guard, rollback.\n',
  );
}

try {
  await verifyIntegration();
} finally {
  await raw.product.deleteMany();
  await raw.$disconnect();
}
