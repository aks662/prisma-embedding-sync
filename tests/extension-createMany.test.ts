/** @file Tests batched embedding mapping, validation, and PostgreSQL trigger persistence. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DimensionMismatchError,
  PrismaEmbeddingSyncError,
  UnsupportedOperationError,
  withEmbeddings,
} from '../src/index.js';
import { sha256 } from '../src/hash.js';
import { executeCreateMany } from '../src/extension/createMany.js';
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
  modelName: 'create-many-test',
  embed: vi.fn(async (texts: string[]) => texts.map(vectorForText)),
});
const makeConfig = (provider: ModelEmbedConfig['provider'] = makeProvider()): ModelEmbedConfig => ({
  sourceFields,
  targetField: 'embedding',
  hashField: 'embeddingHash',
  provider,
  dimensions: 3,
});

describe('createMany embedding input mapping', () => {
  it('preserves a single-object Prisma input shape', async () => {
    const provider = makeProvider();
    const config = makeConfig(provider);
    const query = vi.fn(async (args: { data: unknown }) => args);
    const args = { data: { name: 'One', description: ' item ', price: '1.00' } };

    const result = await executeCreateMany('Product', args, query, { Product: config });
    expect(provider.embed).toHaveBeenCalledExactlyOnceWith(['One item']);
    expect(result).toEqual({
      data: {
        ...args.data,
        embeddingInput: `[${vectorForText('One item').join(',')}]`,
        embeddingHash: sha256('One item'),
      },
    });
  });

  it('maps non-empty embedding results back to original row indexes around empty rows', async () => {
    const provider = makeProvider();
    const config = makeConfig(provider);
    const query = vi.fn(async (args: { data: unknown }) => args);
    const rows = [
      { name: '  ', description: '', price: '1.00' },
      { name: 'First', description: ' item ', price: '2.00' },
      { name: 'Second', description: ' item ', price: '3.00' },
      { name: '', description: '  ', price: '4.00' },
    ];

    const result = await executeCreateMany('Product', { data: rows }, query, { Product: config });
    expect(provider.embed).toHaveBeenCalledExactlyOnceWith(['First item', 'Second item']);
    expect(result).toEqual({
      data: [
        { ...rows[0], embeddingInput: null, embeddingHash: null },
        {
          ...rows[1],
          embeddingInput: `[${vectorForText('First item').join(',')}]`,
          embeddingHash: sha256('First item'),
        },
        {
          ...rows[2],
          embeddingInput: `[${vectorForText('Second item').join(',')}]`,
          embeddingHash: sha256('Second item'),
        },
        { ...rows[3], embeddingInput: null, embeddingHash: null },
      ],
    });
  });

  it.each([
    ['wrong vector count', async () => []],
    ['wrong dimensions', async (texts: string[]) => texts.map(() => [0.1, 0.2])],
    ['non-finite component', async (texts: string[]) => texts.map(() => [0.1, Number.NaN, 0.3])],
  ])('rejects %s before calling the database mutation', async (_label, embed) => {
    const provider = { ...makeProvider(), embed };
    const query = vi.fn(async (args: { data: unknown }) => args);
    const config = makeConfig(provider);

    await expect(
      executeCreateMany(
        'Product',
        { data: [{ name: 'Invalid', description: 'vector', price: '1.00' }] },
        query,
        { Product: config },
      ),
    ).rejects.toBeInstanceOf(PrismaEmbeddingSyncError);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects malformed row and nested values before provider or mutation', async () => {
    const provider = makeProvider();
    const query = vi.fn(async (args: { data: unknown }) => args);
    const config = makeConfig(provider);

    await expect(
      executeCreateMany('Product', { data: [null] }, query, { Product: config }),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(
      executeCreateMany(
        'Product',
        { data: [{ name: 'Nested', description: '', price: '1.00', relation: { connect: 1 } }] },
        query,
        { Product: config },
      ),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);
    expect(provider.embed).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

const dbIntegration = describe.skipIf(process.env.DB_INTEGRATION !== '1');

dbIntegration('Prisma createMany hook with pgvector trigger', () => {
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

  it('persists ten non-empty rows with distinct matching vectors and hashes', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      name: `Item ${String(index).padStart(2, '0')}`,
      description: `details ${index}`,
      price: `${index + 1}.00`,
    }));
    const count = await extended.product.createMany({ data: rows });

    expect(count.count).toBe(10);
    expect(provider.embed).toHaveBeenCalledExactlyOnceWith(
      rows.map((row) => `${row.name} ${row.description}`),
    );
    for (const row of rows) {
      const persisted = await client.product.findFirst({ where: { name: row.name } });
      expect(persisted).not.toBeNull();
      const inspected = await findProduct(client, persisted!.id);
      const normalized = `${row.name} ${row.description}`;
      expect(inspected?.embedding).toBe(`[${vectorForText(normalized).join(',')}]`);
      expect(inspected?.embeddingHash).toBe(sha256(normalized));
      expect(persisted?.embeddingInput).toBeNull();
    }
  });

  it('persists mixed empty and non-empty rows without shifting vector mappings', async () => {
    const rows = [
      { name: ' ', description: '', price: '1.00' },
      { name: 'Second', description: 'row', price: '2.00' },
      { name: '', description: ' \n ', price: '3.00' },
      { name: 'Fourth', description: 'row', price: '4.00' },
    ];
    const result = await extended.product.createMany({ data: rows });

    expect(result.count).toBe(4);
    expect(provider.embed).toHaveBeenCalledExactlyOnceWith(['Second row', 'Fourth row']);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const persisted = await client.product.findFirst({ where: { name: row.name } });
      expect(persisted).not.toBeNull();
      const inspected = await findProduct(client, persisted!.id);
      const normalized = [row.name.trim(), row.description.trim()].filter(Boolean).join(' ');
      if (normalized.length === 0) {
        expect(inspected?.embedding).toBeNull();
        expect(inspected?.embeddingHash).toBeNull();
      } else {
        expect(inspected?.embedding).toBe(`[${vectorForText(normalized).join(',')}]`);
        expect(inspected?.embeddingHash).toBe(sha256(normalized));
      }
    }
  });

  it('accepts the single-object createMany input form', async () => {
    const result = await extended.product.createMany({
      data: { name: 'Single', description: 'row', price: '5.00' },
    });
    const persisted = await client.product.findFirst({ where: { name: 'Single' } });
    const inspected = persisted === null ? null : await findProduct(client, persisted.id);

    expect(result.count).toBe(1);
    expect(inspected?.embedding).toBe(`[${vectorForText('Single row').join(',')}]`);
    expect(inspected?.embeddingHash).toBe(sha256('Single row'));
  });

  it('embeds duplicate candidates when skipDuplicates is true and documents DB-side skipping', async () => {
    const existing = await extended.product.create({
      data: { name: 'Existing', description: 'row', price: '9.00' },
    });
    provider.embed.mockClear();
    const candidates = [
      { id: existing.id, name: 'Duplicate', description: 'candidate', price: '1.00' },
      { id: 40001, name: 'Fresh', description: 'candidate', price: '2.00' },
    ];
    const result = await extended.product.createMany({ data: candidates, skipDuplicates: true });

    expect(provider.embed).toHaveBeenCalledExactlyOnceWith([
      'Duplicate candidate',
      'Fresh candidate',
    ]);
    expect(result.count).toBe(1);
    expect(await client.product.count()).toBe(2);
    const preserved = await findProduct(client, existing.id);
    const fresh = await findProduct(client, 40001);
    expect(preserved?.name).toBe('Existing');
    expect(preserved?.embeddingHash).toBe(sha256('Existing row'));
    expect(fresh?.embedding).toBe(`[${vectorForText('Fresh candidate').join(',')}]`);
    expect(fresh?.embeddingHash).toBe(sha256('Fresh candidate'));
  });

  it('inserts no rows when the provider returns a malformed batch', async () => {
    provider.embed.mockResolvedValueOnce([[0.1, 0.2, 0.3]]);
    const rows = [
      { name: 'First', description: 'invalid batch', price: '1.00' },
      { name: 'Second', description: 'invalid batch', price: '2.00' },
    ];

    await expect(extended.product.createMany({ data: rows })).rejects.toBeInstanceOf(
      DimensionMismatchError,
    );
    expect(provider.embed).toHaveBeenCalledOnce();
    expect(await client.product.count()).toBe(0);
  });

  it('rolls back all createMany rows in an interactive transaction', async () => {
    await expect(
      extended.$transaction(async (tx) => {
        await tx.product.createMany({
          data: [
            { name: 'Interactive A', description: 'rollback', price: '1.00' },
            { name: 'Interactive B', description: 'rollback', price: '2.00' },
          ],
        });
        throw new Error('force createMany interactive rollback');
      }),
    ).rejects.toThrow('force createMany interactive rollback');
    expect(await client.product.count()).toBe(0);
  });

  it('rolls back all createMany rows in a failed batch transaction', async () => {
    const createMany = extended.product.createMany({
      data: [
        { name: 'Batch A', description: 'rollback', price: '1.00' },
        { name: 'Batch B', description: 'rollback', price: '2.00' },
      ],
    });
    const insert = client.$executeRaw`
      INSERT INTO "Product" ("id", "name", "description", "price")
      VALUES (40002, 'batch conflict', 'forced failure', 1.00)
    `;
    const duplicate = client.$executeRaw`
      INSERT INTO "Product" ("id", "name", "description", "price")
      VALUES (40002, 'batch conflict again', 'forced failure', 1.00)
    `;

    await expect(extended.$transaction([createMany, insert, duplicate])).rejects.toThrow();
    expect(await client.product.count()).toBe(0);
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
