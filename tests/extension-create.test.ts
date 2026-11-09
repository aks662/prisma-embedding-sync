/** @file Tests embedding injection and the create hook against the guarded PostgreSQL fixture. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  DimensionMismatchError,
  MockProvider,
  PrismaEmbeddingSyncError,
  UnsupportedOperationError,
  withEmbeddings,
} from '../src/index.js';
import { sha256, normalizeSourceFields } from '../src/hash.js';
import { injectEmbedding } from '../src/extension/inject.js';
import { createTestClient } from './helpers/client.js';
import { resetTestDatabase } from './helpers/db.js';
import { findProduct } from './helpers/seed.js';
import type { ModelEmbedConfig } from '../src/types.js';

const modelConfig = {
  sourceFields: ['name', 'description'],
  targetField: 'embedding',
  hashField: 'embeddingHash',
  provider: new MockProvider({ dimensions: 3 }),
  dimensions: 3,
};

describe('embedding injection for create', () => {
  it('uses normalized source text for one vector and its hash without mutating input', async () => {
    const embed = vi.fn(async (texts: string[]) => [[0.1, -0.2, 0.3]].slice(0, texts.length));
    const input = {
      name: '  Mechanical keyboard ',
      description: ' tactile switches  ',
      price: '29.00',
    };
    const config = { ...modelConfig, provider: { ...modelConfig.provider, embed } };
    const injected = await injectEmbedding(input, config);
    const normalized = 'Mechanical keyboard tactile switches';

    expect(embed).toHaveBeenCalledExactlyOnceWith([normalized]);
    expect(injected).toEqual({
      ...input,
      embeddingInput: '[0.1,-0.2,0.3]',
      embeddingHash: sha256(normalized),
    });
    expect(input).toEqual({
      name: '  Mechanical keyboard ',
      description: ' tactile switches  ',
      price: '29.00',
    });
    expect(normalizeSourceFields(input, modelConfig.sourceFields)).toBe(normalized);
  });

  it('stages null vector and hash without calling the provider for empty normalized source', async () => {
    const embed = vi.fn(async (): Promise<number[][]> => {
      throw new Error('provider should not be called');
    });
    const input = { name: '  ', description: '' };
    const injected = await injectEmbedding(input, {
      ...modelConfig,
      provider: { ...modelConfig.provider, embed },
    });

    expect(embed).not.toHaveBeenCalled();
    expect(injected).toEqual({ ...input, embeddingInput: null, embeddingHash: null });
  });

  it('rejects provider response count, dimensions, and non-finite components', async () => {
    const baseConfig = { ...modelConfig, provider: { ...modelConfig.provider } };
    const noVectors = {
      ...baseConfig,
      provider: { ...baseConfig.provider, embed: async () => [] },
    };
    await expect(
      injectEmbedding({ name: 'text', description: '' }, noVectors),
    ).rejects.toBeInstanceOf(DimensionMismatchError);

    const wrongSize = {
      ...baseConfig,
      provider: { ...baseConfig.provider, embed: async (): Promise<number[][]> => [[0.1, 0.2]] },
    };
    await expect(
      injectEmbedding({ name: 'text', description: '' }, wrongSize),
    ).rejects.toBeInstanceOf(DimensionMismatchError);

    const nonFinite = {
      ...baseConfig,
      provider: {
        ...baseConfig.provider,
        embed: async (): Promise<number[][]> => [[0.1, Number.NaN, 0.3]],
      },
    };
    await expect(
      injectEmbedding({ name: 'text', description: '' }, nonFinite),
    ).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });
});

const dbIntegration = describe.skipIf(process.env.DB_INTEGRATION !== '1');

dbIntegration('Prisma create hook with pgvector trigger', () => {
  let client: ReturnType<typeof createTestClient>;
  let extended: ReturnType<typeof createExtendedClient>;
  let provider: MockProvider;
  const queryEvents: string[] = [];

  beforeAll(() => {
    client = createTestClient();
    client.$on('query', (event) => queryEvents.push(event.query));
    provider = new MockProvider({ dimensions: 3 });
    extended = createExtendedClient(client, provider);
  });

  beforeEach(async () => {
    await resetTestDatabase(client);
    provider.embedCallCount = 0;
  });

  afterAll(async () => {
    if (client !== undefined) {
      await resetTestDatabase(client);
      await client.$disconnect();
    }
  });

  it('persists product fields, matching hash, and trigger-written vector in one Prisma create', async () => {
    const firstQueryIndex = queryEvents.length;
    const product = await extended.product.create({
      data: {
        name: '  Wired keyboard ',
        description: ' tactile key switches ',
        price: '49.00',
      },
    });
    const normalized = 'Wired keyboard tactile key switches';
    const persisted = await findProduct(client, product.id);
    const productInserts = queryEvents
      .slice(firstQueryIndex)
      .filter((query) => /^\s*INSERT\s+INTO\s+.*"Product"/i.test(query));

    expect(provider.embedCallCount).toBe(1);
    expect(product.name).toBe('  Wired keyboard ');
    expect(product.embeddingInput).toBeNull();
    expect(persisted?.name).toBe('  Wired keyboard ');
    expect(persisted?.description).toBe(' tactile key switches ');
    expect(persisted?.price).toBe('49.00');
    expect(persisted?.embeddingHash).toBe(sha256(normalized));
    expect(persisted?.embedding).not.toBeNull();
    expect(productInserts).toHaveLength(1);
  });

  it('writes null vector and hash without a provider call for empty source text', async () => {
    const product = await extended.product.create({
      data: { name: '  ', description: '\n ', price: '5.00' },
    });
    const persisted = await findProduct(client, product.id);

    expect(provider.embedCallCount).toBe(0);
    expect(product.embeddingInput).toBeNull();
    expect(persisted?.embedding).toBeNull();
    expect(persisted?.embeddingHash).toBeNull();
  });

  it('rejects array-style create input with UnsupportedOperationError before a write', async () => {
    const invalidData = [] as unknown as Prisma.ProductCreateArgs['data'];

    await expect(extended.product.create({ data: invalidData })).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
    expect(provider.embedCallCount).toBe(0);
    expect(await client.product.count()).toBe(0);
  });

  it('rejects nested relation and object values before provider or database work', async () => {
    const invalidData = {
      name: 'nested create',
      description: '',
      price: '5.00',
      arbitraryJson: { nested: true },
    } as unknown as Prisma.ProductCreateArgs['data'];

    await expect(extended.product.create({ data: invalidData })).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
    expect(provider.embedCallCount).toBe(0);
    expect(await client.product.count()).toBe(0);
  });

  it('does not write a row when the provider fails', async () => {
    provider.failNextWith = new Error('provider failure');

    await expect(
      extended.product.create({
        data: { name: 'provider failure', description: 'no row', price: '5.00' },
      }),
    ).rejects.toThrow('provider failure');
    expect(provider.embedCallCount).toBe(1);
    expect(await client.product.count()).toBe(0);
  });

  it('does not write a row when a provider returns invalid dimensions or values', async () => {
    const malformedProvider = {
      dimensions: 3,
      modelName: 'malformed',
      embed: async (): Promise<number[][]> => [[0.1, Number.NaN]],
    };
    const malformedClient = createExtendedClient(client, malformedProvider);

    await expect(
      malformedClient.product.create({
        data: { name: 'bad vector', description: 'invalid', price: '5.00' },
      }),
    ).rejects.toBeInstanceOf(DimensionMismatchError);
    expect(await client.product.count()).toBe(0);

    const nonFiniteProvider = {
      dimensions: 3,
      modelName: 'non-finite',
      embed: async (): Promise<number[][]> => [[0.1, Number.NaN, 0.3]],
    };
    const nonFiniteClient = createExtendedClient(client, nonFiniteProvider);
    await expect(
      nonFiniteClient.product.create({
        data: { name: 'non-finite vector', description: 'invalid', price: '5.00' },
      }),
    ).rejects.toBeInstanceOf(PrismaEmbeddingSyncError);
    expect(await client.product.count()).toBe(0);
  });

  it('rolls back the trigger-written vector, hash, and normal fields in an interactive transaction', async () => {
    await expect(
      extended.$transaction(async (tx) => {
        await tx.product.create({
          data: { name: 'interactive create rollback', description: 'rollback', price: '5.00' },
        });
        throw new Error('force create interactive rollback');
      }),
    ).rejects.toThrow('force create interactive rollback');

    expect(await client.product.count()).toBe(0);
  });

  it('rolls back trigger-backed create when a later batch operation fails', async () => {
    const create = extended.product.create({
      data: { name: 'batch create rollback', description: 'rollback', price: '5.00' },
    });
    const firstInsert = client.$executeRaw`
      INSERT INTO "Product" ("id", "name", "description", "price")
      VALUES (999997, 'batch conflict', 'forced failure', 1.00)
    `;
    const duplicateInsert = client.$executeRaw`
      INSERT INTO "Product" ("id", "name", "description", "price")
      VALUES (999997, 'batch conflict again', 'forced failure', 1.00)
    `;

    await expect(extended.$transaction([create, firstInsert, duplicateInsert])).rejects.toThrow();
    expect(await client.product.count()).toBe(0);
  });
});

function createExtendedClient(
  client: ReturnType<typeof createTestClient>,
  embeddingProvider: ModelEmbedConfig['provider'],
) {
  return withEmbeddings(client, {
    models: { Product: { ...modelConfig, provider: embeddingProvider } },
  });
}
