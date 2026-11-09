/** @file Tests scalar update validation, hash-guarded dirty checks, and pgvector persistence. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { UnsupportedOperationError, withEmbeddings } from '../src/index.js';
import { sha256 } from '../src/hash.js';
import { executeUpdate } from '../src/extension/update.js';
import type { ModelEmbedConfig } from '../src/types.js';
import { createTestClient } from './helpers/client.js';
import { resetTestDatabase } from './helpers/db.js';
import { findProduct } from './helpers/seed.js';

const sourceFields = ['name', 'description'];
const vector = [0.125, -0.25, 0.5];
const makeProvider = () => ({
  dimensions: 3,
  modelName: 'update-test',
  embed: vi.fn(async (texts: string[]) => texts.map(() => vector)),
});
const makeConfig = (provider = makeProvider()): ModelEmbedConfig => ({
  sourceFields,
  targetField: 'embedding',
  hashField: 'embeddingHash',
  provider,
  dimensions: 3,
});

describe('Prisma update hook input contract', () => {
  it('executes direct non-source scalar updates without invoking the provider', async () => {
    const provider = makeProvider();
    const config = makeConfig(provider);
    const query = vi.fn(async (args: { where: unknown; data: unknown }) => args);
    const args = { where: { id: 1 }, data: { price: '12.00' } };

    await expect(executeUpdate('Product', args, query, { Product: config })).resolves.toEqual(args);
    expect(query).toHaveBeenCalledExactlyOnceWith(args);
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it('stages the vector and matching hash for complete source changes', async () => {
    const provider = makeProvider();
    const config = makeConfig(provider);
    const query = vi.fn(async (args: { where: unknown; data: unknown }) => args);
    const args = {
      where: { id: 1, embeddingHash: 'old-hash' },
      data: { name: ' Updated name ', description: ' updated description ', price: '12.00' },
    };

    const result = await executeUpdate('Product', args, query, { Product: config });
    const source = 'Updated name updated description';
    expect(provider.embed).toHaveBeenCalledExactlyOnceWith([source]);
    expect(result).toEqual({
      ...args,
      data: {
        ...args.data,
        embeddingInput: '[0.125,-0.25,0.5]',
        embeddingHash: sha256(source),
      },
    });
  });

  it('skips provider work when the supplied source hash is unchanged', async () => {
    const provider = makeProvider();
    const config = makeConfig(provider);
    const source = 'Same name Same description';
    const args = {
      where: { id: 1, embeddingHash: sha256(source) },
      data: { name: ' Same name ', description: 'Same description' },
    };
    const query = vi.fn(async (input: typeof args) => input);

    await expect(executeUpdate('Product', args, query, { Product: config })).resolves.toEqual(args);
    expect(provider.embed).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledExactlyOnceWith(args);
  });

  it('rejects incomplete source updates and missing optimistic hash before work', async () => {
    const provider = makeProvider();
    const config = makeConfig(provider);
    const query = vi.fn(async (args: { where: unknown; data: unknown }) => args);

    await expect(
      executeUpdate('Product', { where: { id: 1 }, data: { name: 'new' } }, query, {
        Product: config,
      }),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(
      executeUpdate(
        'Product',
        { where: { id: 1 }, data: { name: 'new', description: 'new' } },
        query,
        { Product: config },
      ),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);
    expect(query).not.toHaveBeenCalled();
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it.each([
    ['atomic operator', { price: { increment: 1 } }],
    ['nested relation', { owner: { connect: { id: 4 } } }],
    ['array input', { labels: ['a', 'b'] }],
    ['managed hash', { embeddingHash: 'forged' }],
  ])('rejects %s before invoking provider or mutation', async (_label, data) => {
    const provider = makeProvider();
    const config = makeConfig(provider);
    const query = vi.fn(async (args: { where: unknown; data: unknown }) => args);
    await expect(
      executeUpdate('Product', { where: { id: 1, embeddingHash: null }, data }, query, {
        Product: config,
      }),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);
    expect(query).not.toHaveBeenCalled();
    expect(provider.embed).not.toHaveBeenCalled();
  });
});

const dbIntegration = describe.skipIf(process.env.DB_INTEGRATION !== '1');

dbIntegration('Prisma update hook with pgvector trigger', () => {
  let client: ReturnType<typeof createTestClient>;
  let extended: ReturnType<typeof createExtendedClient>;
  let provider: ReturnType<typeof makeProvider>;

  beforeAll(() => {
    client = createTestClient();
    provider = makeProvider();
    extended = createExtendedClient(client, provider);
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

  it('updates non-source fields and preserves vector/hash without a provider call', async () => {
    const initial = await createProduct(extended, provider);
    const before = await findProduct(client, initial.id);
    const result = await extended.product.update({
      where: { id: initial.id },
      data: { price: '19.00' },
    });
    const after = await findProduct(client, initial.id);

    expect(provider.embed).not.toHaveBeenCalled();
    expect(result.price.toString()).toBe('19');
    expect(after?.price).toBe('19.00');
    expect(after?.embedding).toBe(before?.embedding);
    expect(after?.embeddingHash).toBe(before?.embeddingHash);
  });

  it('atomically persists changed source, hash, and trigger-written vector', async () => {
    const initial = await createProduct(extended, provider);
    provider.embed.mockClear();
    const changedText = 'Changed keyboard Changed tactile switches';
    await extended.product.update({
      where: { id: initial.id, embeddingHash: initial.embeddingHash },
      data: { name: 'Changed keyboard', description: 'Changed tactile switches' },
    });
    const after = await findProduct(client, initial.id);

    expect(provider.embed).toHaveBeenCalledExactlyOnceWith([changedText]);
    expect(after?.name).toBe('Changed keyboard');
    expect(after?.description).toBe('Changed tactile switches');
    expect(after?.embeddingHash).toBe(sha256(changedText));
    expect(after?.embedding).toBe('[0.125,-0.25,0.5]');
  });

  it('clears vector and hash for empty normalized source without provider work', async () => {
    const initial = await createProduct(extended, provider);
    provider.embed.mockClear();
    await extended.product.update({
      where: { id: initial.id, embeddingHash: initial.embeddingHash },
      data: { name: '  ', description: '\n ' },
    });
    const after = await findProduct(client, initial.id);

    expect(provider.embed).not.toHaveBeenCalled();
    expect(after?.embedding).toBeNull();
    expect(after?.embeddingHash).toBeNull();
  });

  it('rejects missing hash guard and unsupported source shapes without changing row', async () => {
    const initial = await createProduct(extended, provider);
    const before = await findProduct(client, initial.id);
    provider.embed.mockClear();

    await expect(
      extended.product.update({
        where: { id: initial.id },
        data: { name: 'Unsafe', description: 'Unsafe' },
      }),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(
      extended.product.update({
        where: { id: initial.id, embeddingHash: initial.embeddingHash },
        data: {
          name: { set: 'Unsafe' },
          description: 'Unsafe',
        } as unknown as Prisma.ProductUpdateInput,
      }),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);
    expect(provider.embed).not.toHaveBeenCalled();
    expect(await findProduct(client, initial.id)).toEqual(before);
  });

  it('does not mutate source, vector, or hash when the provider fails', async () => {
    const initial = await createProduct(extended, provider);
    const before = await findProduct(client, initial.id);
    provider.embed.mockRejectedValueOnce(new Error('update provider failure'));

    await expect(
      extended.product.update({
        where: { id: initial.id, embeddingHash: initial.embeddingHash },
        data: { name: 'Provider failure', description: 'No partial write' },
      }),
    ).rejects.toThrow('update provider failure');

    expect(await findProduct(client, initial.id)).toEqual(before);
  });

  it('rolls back source, vector, and hash in an interactive transaction', async () => {
    const initial = await createProduct(extended, provider);
    const before = await findProduct(client, initial.id);
    await expect(
      extended.$transaction(async (tx) => {
        await tx.product.update({
          where: { id: initial.id, embeddingHash: initial.embeddingHash },
          data: { name: 'Rollback name', description: 'Rollback description' },
        });
        throw new Error('force update rollback');
      }),
    ).rejects.toThrow('force update rollback');
    expect(await findProduct(client, initial.id)).toEqual(before);
  });

  it('rolls back an update when a later batch transaction operation fails', async () => {
    const initial = await createProduct(extended, provider);
    const before = await findProduct(client, initial.id);
    const update = extended.product.update({
      where: { id: initial.id, embeddingHash: initial.embeddingHash },
      data: { name: 'Batch rollback name', description: 'Batch rollback description' },
    });
    const firstInsert = client.$executeRaw`
      INSERT INTO "Product" ("id", "name", "description", "price")
      VALUES (999996, 'batch conflict', 'forced failure', 1.00)
    `;
    const duplicateInsert = client.$executeRaw`
      INSERT INTO "Product" ("id", "name", "description", "price")
      VALUES (999996, 'batch conflict again', 'forced failure', 1.00)
    `;

    await expect(extended.$transaction([update, firstInsert, duplicateInsert])).rejects.toThrow();
    expect(await findProduct(client, initial.id)).toEqual(before);
  });

  it('allows one concurrent update per expected hash and preserves the winning vector', async () => {
    const initial = await createProduct(extended, provider);
    provider.embed.mockClear();
    const proposals = [
      { name: 'Concurrent A', description: 'Description A' },
      { name: 'Concurrent B', description: 'Description B' },
    ];
    const results = await Promise.allSettled(
      proposals.map((data) =>
        extended.product.update({
          where: { id: initial.id, embeddingHash: initial.embeddingHash },
          data,
        }),
      ),
    );
    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');
    const final = await findProduct(client, initial.id);
    const finalText = `${final?.name} ${final?.description}`;

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(provider.embed).toHaveBeenCalledTimes(2);
    expect(final?.embeddingHash).toBe(sha256(finalText));
    expect(final?.embedding).toBe('[0.125,-0.25,0.5]');
  });

  it('rejects updateMany before provider work and leaves every row unchanged', async () => {
    const first = await createProduct(extended, provider);
    const second = await extended.product.create({
      data: { name: ' Second ', description: ' product ', price: '8.00' },
    });
    const beforeFirst = await findProduct(client, first.id);
    const beforeSecond = await findProduct(client, second.id);
    provider.embed.mockClear();

    await expect(
      extended.product.updateMany({ where: {}, data: { price: '1.00' } }),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);

    expect(provider.embed).not.toHaveBeenCalled();
    expect(await findProduct(client, first.id)).toEqual(beforeFirst);
    expect(await findProduct(client, second.id)).toEqual(beforeSecond);
  });
});

function createExtendedClient(
  client: ReturnType<typeof createTestClient>,
  embeddingProvider: ModelEmbedConfig['provider'],
) {
  return withEmbeddings(client, {
    models: {
      Product: {
        sourceFields,
        targetField: 'embedding',
        hashField: 'embeddingHash',
        provider: embeddingProvider,
        dimensions: 3,
      },
    },
  });
}

async function createProduct(
  extended: ReturnType<typeof createExtendedClient>,
  provider: ReturnType<typeof makeProvider>,
) {
  const product = await extended.product.create({
    data: { name: ' Keyboard ', description: ' tactile switches ', price: '49.00' },
  });
  expect(provider.embed).toHaveBeenCalled();
  provider.embed.mockClear();
  return product;
}
