/** @file Defines product create, list, edit, and pgvector semantic-search endpoints. */
import { Router, type Request, type Response } from 'express';
import type { EmbeddingProvider } from 'prisma-embedding-sync';
import type { DemoPrismaClient } from '../db.js';

interface ProductInput {
  name: string;
  description: string;
  price: string;
}

interface ProductSearchRow {
  id: number;
  name: string;
  description: string;
  price: string;
  similarity: number;
}

/** Creates API routes bound to a Prisma client and its matching embedding provider. */
export function createProductRouter(client: DemoPrismaClient, provider: EmbeddingProvider): Router {
  const router = Router();

  router.post('/products', async (request: Request, response: Response): Promise<void> => {
    const input = parseProductInput(request.body);
    if (input === null) {
      response.status(400).json({ error: 'name, description, and numeric price are required' });
      return;
    }
    const product = await client.product.create({ data: input });
    response.status(201).json(toPublicProduct(product));
  });

  router.get('/products', async (_request: Request, response: Response): Promise<void> => {
    const products = await client.product.findMany({ orderBy: { id: 'desc' } });
    response.json(products.map(toPublicProduct));
  });

  router.patch('/products/:id', async (request: Request, response: Response): Promise<void> => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      response.status(400).json({ error: 'id must be a positive integer' });
      return;
    }
    const body = isRecord(request.body) ? request.body : null;
    if (body === null) {
      response.status(400).json({ error: 'request body must be a JSON object' });
      return;
    }
    const existing = await client.product.findUnique({ where: { id } });
    if (existing === null) {
      response.status(404).json({ error: 'product not found' });
      return;
    }

    const sourceChanged = Object.hasOwn(body, 'name') || Object.hasOwn(body, 'description');
    const price = parsePrice(body.price);
    const name = body.name === undefined ? existing.name : parseText(body.name);
    const description =
      body.description === undefined ? existing.description : parseText(body.description);
    if ((Object.hasOwn(body, 'price') && price === null) || name === null || description === null) {
      response
        .status(400)
        .json({ error: 'name/description must be strings and price must be numeric' });
      return;
    }
    if (!sourceChanged && price === null) {
      response.status(400).json({ error: 'provide a source field or price to update' });
      return;
    }

    const data = sourceChanged
      ? { name, description, ...(price === null ? {} : { price }) }
      : { price: price! };
    const where = sourceChanged ? { id, embeddingHash: existing.embeddingHash } : { id };
    const updated = await client.product.update({ where, data });
    response.json(toPublicProduct(updated));
  });

  router.get('/search', async (request: Request, response: Response): Promise<void> => {
    const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    if (query.length === 0) {
      response.status(400).json({ error: 'q is required' });
      return;
    }
    const vectors = await provider.embed([query]);
    const vector = vectors[0];
    if (
      vectors.length !== 1 ||
      vector === undefined ||
      vector.length !== provider.dimensions ||
      !vector.every((value) => Number.isFinite(value))
    ) {
      response.status(502).json({ error: 'embedding provider returned an invalid query vector' });
      return;
    }
    const vectorLiteral = `[${vector.join(',')}]`;
    const products = await client.$queryRaw<ProductSearchRow[]>`
      SELECT
        "id",
        "name",
        "description",
        "price"::text AS "price",
        1 - ("embedding" <=> ${vectorLiteral}::vector(768)) AS "similarity"
      FROM "Product"
      WHERE "embedding" IS NOT NULL
      ORDER BY "embedding" <=> ${vectorLiteral}::vector(768)
      LIMIT 10
    `;
    response.json(products);
  });

  return router;
}

function parseProductInput(value: unknown): ProductInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = parseText(value.name);
  const description = parseText(value.description);
  const price = parsePrice(value.price);
  return name === null || description === null || price === null
    ? null
    : { name, description, price };
}

function parseText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function parsePrice(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Number(value))) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPublicProduct(product: {
  id: number;
  name: string;
  description: string;
  price: { toString(): string };
  embeddingHash: string | null;
}) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price.toString(),
    embeddingHash: product.embeddingHash,
  };
}
