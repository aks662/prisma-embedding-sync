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

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_SEARCH_LENGTH = 500;
const MAX_LIST_SIZE = 100;

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

  router.get('/products', async (request: Request, response: Response): Promise<void> => {
    if (Object.keys(request.query).length > 0) {
      response.status(400).json({ error: 'product listing does not accept query parameters' });
      return;
    }
    const products = await client.product.findMany({
      orderBy: { id: 'desc' },
      take: MAX_LIST_SIZE,
    });
    response.json(products.map(toPublicProduct));
  });

  router.patch('/products/:id', async (request: Request, response: Response): Promise<void> => {
    const idValue = request.params.id;
    const id = typeof idValue === 'string' && /^\d+$/.test(idValue) ? Number(idValue) : NaN;
    if (!Number.isSafeInteger(id) || id <= 0) {
      response.status(400).json({ error: 'id must be a positive integer' });
      return;
    }
    const body = isRecord(request.body) ? request.body : null;
    if (body === null || !hasOnlyKeys(body, ['name', 'description', 'price'])) {
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
    const name = body.name === undefined ? existing.name : parseText(body.name, MAX_NAME_LENGTH);
    const description =
      body.description === undefined
        ? existing.description
        : parseText(body.description, MAX_DESCRIPTION_LENGTH);
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

    if (sourceChanged) {
      const updated = await client.product.update({
        where: { id, embeddingHash: existing.embeddingHash },
        data: { name, description, ...(price === null ? {} : { price }) },
      });
      response.json(toPublicProduct(updated));
      return;
    }
    if (price === null) {
      response.status(400).json({ error: 'provide a source field or price to update' });
      return;
    }
    const updated = await client.product.update({ where: { id }, data: { price } });
    response.json(toPublicProduct(updated));
  });

  router.get('/search', async (request: Request, response: Response): Promise<void> => {
    const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    if (Object.keys(request.query).some((key) => key !== 'q')) {
      response.status(400).json({ error: 'only the q query parameter is supported' });
      return;
    }
    if (query.length === 0) {
      response.status(400).json({ error: 'q is required' });
      return;
    }
    if (query.length > MAX_SEARCH_LENGTH) {
      response.status(400).json({ error: `q must be at most ${MAX_SEARCH_LENGTH} characters` });
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
  if (!isRecord(value) || !hasOnlyKeys(value, ['name', 'description', 'price'])) {
    return null;
  }
  const name = parseText(value.name, MAX_NAME_LENGTH);
  const description = parseText(value.description, MAX_DESCRIPTION_LENGTH);
  const price = parsePrice(value.price);
  return name === null || description === null || price === null
    ? null
    : { name, description, price };
}

function parseText(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
    ? value
    : null;
}

function parsePrice(value: unknown): string | null {
  const price = typeof value === 'number' ? String(value) : value;
  if (typeof price !== 'string' || !/^\d{1,8}(?:\.\d{1,2})?$/.test(price.trim())) {
    return null;
  }
  return price.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function toPublicProduct(product: {
  id: number;
  name: string;
  description: string;
  price: { toString(): string };
}) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price.toString(),
  };
}
