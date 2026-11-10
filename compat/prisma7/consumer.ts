/** @file Strictly verifies generated Prisma 7 model and delegate types through the package API. */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';
import { MockProvider, withEmbeddings } from 'prisma-embedding-sync';
import type { EmbeddingExtension } from 'prisma-embedding-sync';

const raw = new PrismaClient({
  adapter: new PrismaPg({ connectionString: 'postgresql://test:test@127.0.0.1:5432/test' }),
});
const extension: EmbeddingExtension = withEmbeddings({
  models: {
    Product: {
      sourceFields: ['name', 'description'],
      targetField: 'embedding',
      provider: new MockProvider({ dimensions: 3 }),
      dimensions: 3,
    },
  },
});
const db = raw.$extends(extension);

async function verifyGeneratedProductTypes(): Promise<void> {
  const products = await db.product.findMany();
  for (const product of products) {
    product.name.toUpperCase();
    product.embeddingHash?.toUpperCase();
  }
}

void verifyGeneratedProductTypes;
void raw;
