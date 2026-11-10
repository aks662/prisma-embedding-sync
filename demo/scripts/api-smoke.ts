/** @file Exercises demo HTTP routes and verifies source edits versus price-only edits. */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { MockProvider } from 'prisma-embedding-sync';
import { createDemoPrismaClient } from '../src/db.js';
import { createDemoApp, startDemoServer } from '../src/server.js';

const provider = new MockProvider({ dimensions: 768 });
const client = createDemoPrismaClient(provider);
const smokePort = Number(process.env.DEMO_SMOKE_PORT ?? 3001);
assert.ok(Number.isInteger(smokePort) && smokePort > 0 && smokePort <= 65535);
let server: Server | undefined;
let productId: number | undefined;

try {
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => startDemoServer(), /local demo cannot start in production mode/);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }

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
    server!.listen(smokePort, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  assert.equal(address.port, smokePort);
  const baseUrl = `http://127.0.0.1:${smokePort}`;
  const healthResponse = await fetch(`${baseUrl}/healthz`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { status: 'ok' });
  assert.equal(healthResponse.headers.get('x-powered-by'), null);
  assert.equal(healthResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.match(healthResponse.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.match(
    healthResponse.headers.get('content-security-policy') ?? '',
    /frame-ancestors 'none'/,
  );

  const malformedResponse = await fetch(`${baseUrl}/products`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(malformedResponse.status, 400);
  assert.deepEqual(await malformedResponse.json(), { error: 'request body must be valid JSON' });

  const oversizedResponse = await fetch(`${baseUrl}/products`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'x'.repeat(17_000) }),
  });
  assert.equal(oversizedResponse.status, 413);
  assert.deepEqual(await oversizedResponse.json(), { error: 'request body is too large' });

  const suffix = randomUUID();
  const original = {
    name: `Demo smoke ${suffix}`,
    description: 'initial tactile keyboard description',
    price: '79.00',
  };

  const unexpectedFieldResponse = await fetch(`${baseUrl}/products`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...original, embedding: '[1,2,3]' }),
  });
  assert.equal(unexpectedFieldResponse.status, 400);

  const invalidIdResponse = await fetch(`${baseUrl}/products/1e0`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ price: '80.00' }),
  });
  assert.equal(invalidIdResponse.status, 400);

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
    embeddingHash?: unknown;
    embedding?: unknown;
    embeddingInput?: unknown;
  };
  productId = created.id;
  assert.equal(provider.embedCallCount, 1);
  assert.equal('embedding' in created, false);
  assert.equal('embeddingInput' in created, false);
  assert.equal('embeddingHash' in created, false);

  const oversizedDescriptionResponse = await fetch(`${baseUrl}/products`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...original, description: 'x'.repeat(2_001) }),
  });
  assert.equal(oversizedDescriptionResponse.status, 400);

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
  assert.equal(
    listed.some((product) => 'embeddingInput' in product || 'embeddingHash' in product),
    false,
  );
  const unsupportedListingQuery = await fetch(`${baseUrl}/products?take=1000`);
  assert.equal(unsupportedListingQuery.status, 400);

  const beforeDescription = await inspectEmbedding(client, productId);
  assert.ok(beforeDescription.embedding);
  assert.ok(beforeDescription.embeddingHash);
  assert.equal(beforeDescription.embeddingInput, null);
  const descriptionResponse = await fetch(`${baseUrl}/products/${productId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'updated linear switch keyboard' }),
  });
  assert.equal(descriptionResponse.status, 200);
  const afterDescription = (await descriptionResponse.json()) as Record<string, unknown>;
  assert.equal('embedding' in afterDescription, false);
  assert.equal('embeddingInput' in afterDescription, false);
  assert.equal('embeddingHash' in afterDescription, false);
  assert.equal(provider.embedCallCount, 2);
  const updatedEmbedding = await inspectEmbedding(client, productId);
  assert.notEqual(updatedEmbedding.embedding, beforeDescription.embedding);
  assert.notEqual(updatedEmbedding.embeddingHash, beforeDescription.embeddingHash);
  assert.ok(updatedEmbedding.embeddingHash);
  assert.equal(updatedEmbedding.embeddingInput, null);

  const priceResponse = await fetch(`${baseUrl}/products/${productId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ price: '85.00' }),
  });
  assert.equal(priceResponse.status, 200);
  const priceBody = (await priceResponse.json()) as Record<string, unknown>;
  assert.equal('embedding' in priceBody, false);
  assert.equal('embeddingInput' in priceBody, false);
  assert.equal('embeddingHash' in priceBody, false);
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
  assert.equal('embeddingInput' in match, false);
  assert.equal('embeddingHash' in match, false);
  assert.equal(provider.embedCallCount, 3);

  const unexpectedSearchParamResponse = await fetch(`${baseUrl}/search?q=linear&limit=1000`);
  assert.equal(unexpectedSearchParamResponse.status, 400);
  assert.equal(provider.embedCallCount, 3);

  const oversizedSearchResponse = await fetch(`${baseUrl}/search?q=${'x'.repeat(501)}`);
  assert.equal(oversizedSearchResponse.status, 400);
  assert.equal(provider.embedCallCount, 3);

  provider.failNextWith = new Error('internal database and provider details');
  const providerFailureResponse = await fetch(`${baseUrl}/products`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...original, name: `Failure probe ${suffix}` }),
  });
  assert.equal(providerFailureResponse.status, 500);
  const providerFailureBody = await providerFailureResponse.text();
  assert.equal(providerFailureBody, '{"error":"internal server error"}');
  assert.equal(providerFailureBody.includes('internal database and provider details'), false);
  assert.equal(provider.embedCallCount, 4);

  const allowedMutation: Response = await fetch(`${baseUrl}/products/${productId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ price: '86.00' }),
  });
  assert.equal(allowedMutation.status, 200);
  const limitedMutation = await fetch(`${baseUrl}/products/${productId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ price: '88.00' }),
  });
  assert.equal(limitedMutation.status, 429);
  assert.match(limitedMutation.headers.get('retry-after') ?? '', /^\d+$/);
  assert.equal(provider.embedCallCount, 4);

  for (let index = 0; index < 17; index += 1) {
    const allowedSearch = await fetch(`${baseUrl}/search?q=keyboard%20${index}`);
    assert.equal(allowedSearch.status, 200);
  }
  assert.equal(provider.embedCallCount, 21);
  const limitedSearch = await fetch(`${baseUrl}/search?q=keyboard%20rate%20limit`);
  assert.equal(limitedSearch.status, 429);
  assert.match(limitedSearch.headers.get('retry-after') ?? '', /^\d+$/);
  assert.equal(provider.embedCallCount, 21);

  process.stdout.write(
    'Demo API smoke passed: validation, rate limits, create/list, description re-embed, price-only skip, and cosine search.\n',
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
): Promise<{
  embedding: string | null;
  embeddingHash: string | null;
  embeddingInput: string | null;
}> {
  const rows = await prisma.$queryRaw<
    Array<{ embedding: string | null; embeddingHash: string | null; embeddingInput: string | null }>
  >`
    SELECT "embedding"::text AS "embedding", "embeddingHash", "embeddingInput"
    FROM "Product"
    WHERE "id" = ${id}
  `;
  assert.equal(rows.length, 1);
  return rows[0]!;
}
