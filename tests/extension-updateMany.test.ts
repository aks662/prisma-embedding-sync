/** @file Verifies updateMany rejects before provider work or database mutation. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsupportedOperationError, withEmbeddings } from '../src/index.js';
import { rejectUpdateMany } from '../src/extension/updateMany.js';
import type { ModelEmbedConfig } from '../src/types.js';
import { createTestClient } from './helpers/client.js';
import { resetTestDatabase } from './helpers/db.js';
import { findProduct } from './helpers/seed.js';

const provider = {
  dimensions: 3,
  modelName: 'update-many-test',
  embed: vi.fn(async () => [[0.1, 0.2, 0.3]]),
};
const modelConfig: ModelEmbedConfig = {
  sourceFields: ['name', 'description'],
  targetField: 'embedding',
  hashField: 'embeddingHash',
  provider,
  dimensions: 3,
};

describe('updateMany guard', () => {
  it('throws an actionable UnsupportedOperationError for a model', () => {
    expect(() => rejectUpdateMany('Product')).toThrow(UnsupportedOperationError);
    expect(() => rejectUpdateMany('Product')).toThrow(/use update for one row at a time/);
  });
});

const dbIntegration = describe.skipIf(process.env.DB_INTEGRATION !== '1');

dbIntegration('Prisma updateMany guard with PostgreSQL', () => {
  let client: ReturnType<typeof createTestClient>;
  let extended: ReturnType<typeof withEmbeddingsForTest>;

  beforeAll(() => {
    client = createTestClient();
    extended = withEmbeddingsForTest(client);
  });

  beforeEach(async () => {
    await resetTestDatabase(client);
    provider.embed.mockClear();
  });

  afterAll(async () => {
    if (client !== undefined) {
      await resetTestDatabase(client);
      await client.$disconnect();
    }
  });

  it('throws before mutation/provider work and preserves rows, vectors, and hashes', async () => {
    const row = await extended.product.create({
      data: { name: 'Stable', description: 'product', price: '5.00' },
    });
    const before = await findProduct(client, row.id);
    const countBefore = await client.product.count();
    provider.embed.mockClear();

    await expect(
      extended.product.updateMany({ where: {}, data: { price: '1.00' } }),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);

    expect(provider.embed).not.toHaveBeenCalled();
    expect(await client.product.count()).toBe(countBefore);
    expect(await findProduct(client, row.id)).toEqual(before);
  });
});

function withEmbeddingsForTest(client: ReturnType<typeof createTestClient>) {
  return client.$extends(withEmbeddings({ models: { Product: modelConfig } }));
}
