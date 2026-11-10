/** @file Tests native upsert preparation, conflict behavior, and trigger persistence. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsupportedOperationError, withEmbeddings } from '../src/index.js';
import { sha256 } from '../src/hash.js';
import { executeUpsert } from '../src/extension/upsert.js';
import type { ModelEmbedConfig } from '../src/types.js';
import { createTestClient } from './helpers/client.js';
import { resetTestDatabase } from './helpers/db.js';
import { findProduct } from './helpers/seed.js';

const sourceFields = ['name', 'description'];
const vectorForText = (text: string): number[] => [
  text.length / 100,
  text.charCodeAt(0) / 1000,
  text.charCodeAt(text.length - 1) / 1000,
];
const makeProvider = () => ({
  dimensions: 3,
  modelName: 'upsert-test',
  embed: vi.fn(async (texts: string[]) => texts.map(vectorForText)),
});
const makeConfig = (provider: ModelEmbedConfig['provider'] = makeProvider()): ModelEmbedConfig => ({
  sourceFields,
  targetField: 'embedding',
  hashField: 'embeddingHash',
  provider,
  dimensions: 3,
});

describe('upsert input preparation', () => {
  it('stages both create and dirty-update candidates in one provider batch', async () => {
    const provider = makeProvider();
    const config = makeConfig(provider);
    const query = vi.fn(async (args: { where: unknown; create: unknown; update: unknown }) => args);
    const args = {
      where: { id: 1 },
      create: { id: 1, name: 'Create', description: 'branch', price: '1.00' },
      update: { name: 'Update', description: 'branch', price: '2.00' },
    };

    const result = await executeUpsert('Product', args, query, { Product: config });
    expect(provider.embed).toHaveBeenCalledExactlyOnceWith(['Create branch', 'Update branch']);
    expect(result).toEqual({
      ...args,
      create: {
        ...args.create,
        embeddingInput: `[${vectorForText('Create branch').join(',')}]`,
        embeddingHash: sha256('Create branch'),
      },
      update: {
        ...args.update,
        embeddingInput: `[${vectorForText('Update branch').join(',')}]`,
        embeddingHash: sha256('Update branch'),
      },
    });
  });

  it('preserves a clean update branch while preparing its possible create branch', async () => {
    const provider = makeProvider();
    const config = makeConfig(provider);
    const query = vi.fn(async (args: { where: unknown; create: unknown; update: unknown }) => args);
    const args = {
      where: { id: 2 },
      create: { id: 2, name: 'Possible', description: 'create', price: '1.00' },
      update: { price: '2.00' },
    };

    const result = await executeUpsert('Product', args, query, { Product: config });
    expect(provider.embed).toHaveBeenCalledExactlyOnceWith(['Possible create']);
    expect(result).toEqual({
      ...args,
      create: {
        ...args.create,
        embeddingInput: `[${vectorForText('Possible create').join(',')}]`,
        embeddingHash: sha256('Possible create'),
      },
      update: args.update,
    });
  });

  it('rejects non-native or unsafe upsert input before provider or query work', async () => {
    const provider = makeProvider();
    const config = makeConfig(provider);
    const query = vi.fn(async (args: { where: unknown; create: unknown; update: unknown }) => args);
    const valid = {
      where: { id: 3 },
      create: { id: 3, name: 'One', description: 'two', price: '1.00' },
      update: { price: '2.00' },
    };
    const invalid = [
      { ...valid, where: { id: 3, name: 'One' } },
      { ...valid, create: { ...valid.create, id: 4 } },
      { ...valid, update: { name: 'partial source' } },
      { ...valid, update: { price: { increment: 1 } } },
      { ...valid, update: { price: '2.00', relation: { connect: { id: 1 } } } },
      { ...valid, update: { id: 4, price: '2.00' } },
    ];

    for (const args of invalid) {
      await expect(
        executeUpsert('Product', args, query, { Product: config }),
      ).rejects.toBeInstanceOf(UnsupportedOperationError);
    }
    expect(provider.embed).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

const dbIntegration = describe.skipIf(process.env.DB_INTEGRATION !== '1');

dbIntegration('Prisma upsert hook with PostgreSQL native conflict handling', () => {
  let client: ReturnType<typeof createTestClient>;
  let extended: ReturnType<typeof createExtendedClient>;
  let provider: ReturnType<typeof makeProvider>;
  const queryEvents: string[] = [];

  beforeAll(() => {
    client = createTestClient();
    client.$on('query', (event) => queryEvents.push(event.query));
    provider = makeProvider();
    extended = createExtendedClient(client, provider);
  });

  beforeEach(async () => {
    await resetTestDatabase(client);
    provider.embed.mockClear();
    queryEvents.length = 0;
  });

  afterAll(async () => {
    if (client !== undefined) {
      await resetTestDatabase(client);
      await client.$disconnect();
    }
  });

  it('creates a row through native upsert and persists its vector/hash', async () => {
    const result = await extended.product.upsert({
      where: { id: 51001 },
      create: { id: 51001, name: 'Create', description: 'path', price: '1.00' },
      update: { price: '2.00' },
    });
    const persisted = await findProduct(client, 51001);

    expect(provider.embed).toHaveBeenCalledExactlyOnceWith(['Create path']);
    expect(result.embeddingHash).toBe(sha256('Create path'));
    expect(persisted?.embedding).toBe(`[${vectorForText('Create path').join(',')}]`);
    expect(persisted?.embeddingHash).toBe(sha256('Create path'));
    expect(queryEvents.some((sql) => /ON CONFLICT/i.test(sql))).toBe(true);
  });

  it('updates a dirty source branch with its matching trigger-written vector/hash', async () => {
    await extended.product.create({
      data: { id: 51002, name: 'Old', description: 'source', price: '1.00' },
    });
    provider.embed.mockClear();
    queryEvents.length = 0;
    const updateText = 'Updated source';

    const result = await extended.product.upsert({
      where: { id: 51002 },
      create: { id: 51002, name: 'Fallback', description: 'create', price: '3.00' },
      update: { name: 'Updated', description: 'source', price: '2.00' },
    });
    const persisted = await findProduct(client, 51002);

    expect(provider.embed).toHaveBeenCalledExactlyOnceWith(['Fallback create', updateText]);
    expect(result.name).toBe('Updated');
    expect(result.embeddingHash).toBe(sha256(updateText));
    expect(persisted?.embedding).toBe(`[${vectorForText(updateText).join(',')}]`);
    expect(persisted?.embeddingHash).toBe(sha256(updateText));
    expect(queryEvents.some((sql) => /ON CONFLICT/i.test(sql))).toBe(true);
  });

  it('preserves vector/hash on a clean non-source update branch', async () => {
    await extended.product.create({
      data: { id: 51003, name: 'Stable', description: 'source', price: '1.00' },
    });
    const before = await findProduct(client, 51003);
    provider.embed.mockClear();
    const result = await extended.product.upsert({
      where: { id: 51003 },
      create: { id: 51003, name: 'Fallback', description: 'branch', price: '3.00' },
      update: { price: '2.00' },
    });
    const after = await findProduct(client, 51003);

    expect(provider.embed).toHaveBeenCalledExactlyOnceWith(['Fallback branch']);
    expect(result.price.toString()).toBe('2');
    expect(after?.price).toBe('2.00');
    expect(after?.embedding).toBe(before?.embedding);
    expect(after?.embeddingHash).toBe(before?.embeddingHash);
  });

  it('resolves simultaneous same-key upserts atomically without duplicate rows or mismatched vectors', async () => {
    const alternatives = [
      { name: 'Concurrent A', description: 'branch A' },
      { name: 'Concurrent B', description: 'branch B' },
    ];
    const results = await Promise.all(
      alternatives.map((data, index) =>
        extended.product.upsert({
          where: { id: 51004 },
          create: {
            id: 51004,
            name: `Create ${index}`,
            description: 'fallback',
            price: '1.00',
          },
          update: { ...data, price: `${index + 2}.00` },
        }),
      ),
    );
    const persisted = await findProduct(client, 51004);
    const normalized = `${persisted?.name} ${persisted?.description}`;

    expect(results).toHaveLength(2);
    expect(await client.product.count()).toBe(1);
    expect(queryEvents.filter((sql) => /ON CONFLICT/i.test(sql))).toHaveLength(2);
    expect(persisted?.embeddingHash).toBe(sha256(normalized));
    expect(persisted?.embedding).toBe(`[${vectorForText(normalized).join(',')}]`);
  });

  it('rolls back native upsert inside an interactive transaction', async () => {
    await expect(
      extended.$transaction(async (tx) => {
        await tx.product.upsert({
          where: { id: 51005 },
          create: { id: 51005, name: 'Rollback', description: 'interactive', price: '1.00' },
          update: { price: '2.00' },
        });
        throw new Error('force upsert interactive rollback');
      }),
    ).rejects.toThrow('force upsert interactive rollback');
    expect(await client.product.count()).toBe(0);
  });

  it('rolls back native upsert in a failed batch transaction', async () => {
    const upsert = extended.product.upsert({
      where: { id: 51006 },
      create: { id: 51006, name: 'Rollback', description: 'batch', price: '1.00' },
      update: { price: '2.00' },
    });
    const insert = client.$executeRaw`
      INSERT INTO "Product" ("id", "name", "description", "price")
      VALUES (51007, 'conflict', 'first', 1.00)
    `;
    const duplicate = client.$executeRaw`
      INSERT INTO "Product" ("id", "name", "description", "price")
      VALUES (51007, 'conflict', 'second', 1.00)
    `;

    await expect(extended.$transaction([upsert, insert, duplicate])).rejects.toThrow();
    expect(await client.product.count()).toBe(0);
  });

  it('does not insert a row when the provider fails before native upsert', async () => {
    provider.embed.mockRejectedValueOnce(new Error('upsert provider failure'));
    await expect(
      extended.product.upsert({
        where: { id: 51008 },
        create: { id: 51008, name: 'Provider', description: 'failure', price: '1.00' },
        update: { price: '2.00' },
      }),
    ).rejects.toThrow('upsert provider failure');
    expect(await client.product.count()).toBe(0);
  });
});

function createExtendedClient(
  client: ReturnType<typeof createTestClient>,
  embeddingProvider: ModelEmbedConfig['provider'],
) {
  return client.$extends(
    withEmbeddings({
      models: {
        Product: {
          sourceFields,
          targetField: 'embedding',
          hashField: 'embeddingHash',
          provider: embeddingProvider,
          dimensions: 3,
        },
      },
    }),
  );
}
