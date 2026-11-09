/** @file Exercises demo HTTP routes and verifies source edits versus price-only edits. */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { MockProvider } from 'prisma-embedding-sync';
import { createDemoPrismaClient } from '../src/db.js';
import { createDemoApp } from '../src/server.js';

const provider = new MockProvider({ dimensions: 768 });
const client = createDemoPrismaClient(provider);
let server: Server | undefined;
let productId: number | undefined;

try {
  const identity = await client.$queryRaw<Array<{ name: string; vectorEnabled: boolean }>>`
    SELECT current_database() AS "name",
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS "vectorEnabled"
  `;
  assert.equal(identity[0]?.name, 'prisma_embedding_sync_demo');
  assert.equal(identity[0]?.vectorEnabled, true);

  const app = createDemoApp({ client, provider });
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(3001, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  assert.equal(address.port, 3001);
  const baseUrl = 'http://127.0.0.1:3001';
  const suffix = randomUUID();
  const original = {
    name: `Demo smoke ${suffix}`,
    description: 'initial tactile keyboard description',
    price: '79.00',
  };

  const createdResponse = await fetch(`${baseUrl}/products`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(original),
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()) as {
    id: number;
    name: string;
    description: string;
    embeddingHash: string;
    embedding?: unknown;
    embeddingInput?: unknown;
  };
  productId = created.id;
  assert.equal(provider.embedCallCount, 1);
  assert.equal('embedding' in created, false);
  assert.equal('embeddingInput' in created, false);

  const listResponse = await fetch(`${baseUrl}/products`);
  assert.equal(listResponse.status, 200);
  const listed = (await listResponse.json()) as Array<Record<string, unknown>>;
  assert.equal(
    listed.some((product) => product.id === productId),
    true,
  );
  assert.equal(
    listed.some((product) => 'embedding' in product),
    false,
  );

  const beforeDescription = await inspectEmbedding(client, productId);
  const descriptionResponse = await fetch(`${baseUrl}/products/${productId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'updated linear switch keyboard' }),
  });
  assert.equal(descriptionResponse.status, 200);
  const afterDescription = (await descriptionResponse.json()) as { embeddingHash: string };
  assert.equal(provider.embedCallCount, 2);
  assert.notEqual(afterDescription.embeddingHash, created.embeddingHash);
  const updatedEmbedding = await inspectEmbedding(client, productId);
  assert.notEqual(updatedEmbedding.embedding, beforeDescription.embedding);
  assert.equal(updatedEmbedding.embeddingHash, afterDescription.embeddingHash);

  const priceResponse = await fetch(`${baseUrl}/products/${productId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ price: '85.00' }),
  });
  assert.equal(priceResponse.status, 200);
  assert.equal(provider.embedCallCount, 2);
  const afterPrice = await inspectEmbedding(client, productId);
  assert.deepEqual(afterPrice, updatedEmbedding);

  const searchResponse = await fetch(`${baseUrl}/search?q=linear%20switch`);
  assert.equal(searchResponse.status, 200);
  const searchResults = (await searchResponse.json()) as Array<Record<string, unknown>>;
  const match = searchResults.find((result) => result.id === productId);
  assert.ok(match !== undefined);
  assert.equal(typeof match.similarity, 'number');
  assert.equal('embedding' in match, false);
  assert.equal(provider.embedCallCount, 3);

  process.stdout.write(
    'Demo API smoke passed: create/list, description re-embed, price-only skip, and cosine search.\n',
  );
} finally {
  if (productId !== undefined) {
    await client.product.delete({ where: { id: productId } });
  }
  if (server !== undefined) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
  await client.$disconnect();
}

async function inspectEmbedding(
  prisma: ReturnType<typeof createDemoPrismaClient>,
  id: number,
): Promise<{ embedding: string | null; embeddingHash: string | null }> {
  const rows = await prisma.$queryRaw<
    Array<{ embedding: string | null; embeddingHash: string | null }>
  >`
    SELECT "embedding"::text AS "embedding", "embeddingHash"
    FROM "Product"
    WHERE "id" = ${id}
  `;
  assert.equal(rows.length, 1);
  return rows[0]!;
}
