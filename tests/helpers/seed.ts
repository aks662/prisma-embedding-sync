/** @file Inserts and reads controlled Product fixtures through guarded parameterized raw SQL. */
import type { PrismaClient } from '@prisma/client';
import { getTestDatabaseUrl, verifyTestDatabase } from './db.js';

/** Product fixture values accepted by the test database seed helper. */
export interface ProductFixture {
  /** Product display name. */
  name: string;
  /** Product text used by embedding tests. */
  description: string;
  /** Decimal price represented as a base-10 string. */
  price: string;
  /** Optional pgvector value, required to contain exactly three finite values. */
  embedding?: number[] | null;
  /** Optional source hash. */
  embeddingHash?: string | null;
}

/** Database fixture shape returned by direct SQL inspection. */
export interface ProductRecord {
  /** Primary key. */
  id: number;
  /** Product display name. */
  name: string;
  /** Product description. */
  description: string;
  /** Price formatted by PostgreSQL as text. */
  price: string;
  /** Vector formatted by pgvector, or null. */
  embedding: string | null;
  /** Source hash, or null. */
  embeddingHash: string | null;
}

/** Inserts a fixture using one parameterized statement and direct pgvector casting. */
export async function seedProduct(
  client: PrismaClient,
  fixture: ProductFixture,
): Promise<ProductRecord> {
  getTestDatabaseUrl();
  await verifyTestDatabase(client);
  const vectorLiteral = fixture.embedding == null ? null : toVectorLiteral(fixture.embedding);
  const rows = await client.$queryRaw<ProductRecord[]>`
    INSERT INTO "Product" ("name", "description", "price", "embedding", "embeddingHash")
    VALUES (
      ${fixture.name},
      ${fixture.description},
      ${fixture.price}::decimal(10, 2),
      ${vectorLiteral}::vector(3),
      ${fixture.embeddingHash ?? null}
    )
    RETURNING "id", "name", "description", "price"::text AS "price",
      "embedding"::text AS "embedding", "embeddingHash"
  `;
  const record = rows[0];
  if (record === undefined) {
    throw new Error('Product seed insert returned no row');
  }
  return record;
}

/** Reads a Product and its Unsupported vector through raw SQL. */
export async function findProduct(client: PrismaClient, id: number): Promise<ProductRecord | null> {
  getTestDatabaseUrl();
  await verifyTestDatabase(client);
  const rows = await client.$queryRaw<ProductRecord[]>`
    SELECT "id", "name", "description", "price"::text AS "price",
      "embedding"::text AS "embedding", "embeddingHash"
    FROM "Product"
    WHERE "id" = ${id}
  `;
  return rows[0] ?? null;
}

function toVectorLiteral(values: number[]): string {
  if (values.length !== 3 || !values.every(Number.isFinite)) {
    throw new TypeError('test vector must contain exactly three finite components');
  }
  return `[${values.join(',')}]`;
}
