/** @file Creates validated provider vectors and stages them for the database trigger. */
import { DimensionMismatchError, PrismaEmbeddingSyncError } from '../errors.js';
import { normalizeSourceFields, sha256 } from '../hash.js';
import type { ModelEmbedConfig } from '../types.js';

/** Returns a new create payload with hash and Prisma-writable staging value. */
export async function injectEmbedding(
  data: Readonly<Record<string, unknown>>,
  config: ModelEmbedConfig,
): Promise<Record<string, unknown>> {
  const sourceText = normalizeSourceFields(data, config.sourceFields);
  return injectNormalizedEmbedding(data, config, sourceText);
}

/** Returns staged vector/hash values for a source string already normalized by the caller. */
export async function injectNormalizedEmbedding(
  data: Readonly<Record<string, unknown>>,
  config: ModelEmbedConfig,
  sourceText: string,
): Promise<Record<string, unknown>> {
  const hashField = config.hashField ?? `${config.targetField}Hash`;
  const inputField = `${config.targetField}Input`;

  if (sourceText.length === 0) {
    return { ...data, [inputField]: null, [hashField]: null };
  }

  const response: unknown = await config.provider.embed([sourceText]);
  if (!Array.isArray(response) || response.length !== 1 || !Array.isArray(response[0])) {
    throw new DimensionMismatchError(
      `Provider must return exactly one vector for one ${config.provider.modelName} input`,
    );
  }

  const vectorLiteral = serializeVector(response[0], config);
  return {
    ...data,
    [inputField]: vectorLiteral,
    [hashField]: sha256(sourceText),
  };
}

/**
 * Embeds only non-empty rows while retaining explicit source-row and provider-result indexes.
 * Every returned row is a new staging-field payload in its original input position.
 */
export async function injectEmbeddings(
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
  config: ModelEmbedConfig,
): Promise<Record<string, unknown>[]> {
  const hashField = config.hashField ?? `${config.targetField}Hash`;
  const inputField = `${config.targetField}Input`;
  const mappings = rows.flatMap((data, originalIndex) => {
    const sourceText = normalizeSourceFields(data, config.sourceFields);
    return sourceText.length === 0 ? [] : [{ originalIndex, embeddingIndex: 0, sourceText }];
  });

  mappings.forEach((mapping, embeddingIndex) => {
    mapping.embeddingIndex = embeddingIndex;
  });

  const vectors: unknown =
    mappings.length === 0
      ? []
      : await config.provider.embed(mappings.map((mapping) => mapping.sourceText));
  if (!Array.isArray(vectors) || vectors.length !== mappings.length) {
    throw new DimensionMismatchError(
      `Provider returned ${Array.isArray(vectors) ? vectors.length : 'an invalid response'} vectors; expected ${mappings.length}`,
    );
  }

  const injectedRows = rows.map((data) => ({ ...data, [inputField]: null, [hashField]: null }));
  for (const mapping of mappings) {
    const vectorValue: unknown = vectors[mapping.embeddingIndex];
    if (!Array.isArray(vectorValue)) {
      throw new DimensionMismatchError(
        `Provider vector at result index ${mapping.embeddingIndex} must be an array`,
      );
    }
    injectedRows[mapping.originalIndex] = {
      ...rows[mapping.originalIndex],
      [inputField]: serializeVector(vectorValue, config),
      [hashField]: sha256(mapping.sourceText),
    };
  }
  return injectedRows;
}

function serializeVector(vector: unknown[], config: ModelEmbedConfig): string {
  if (vector.length !== config.dimensions) {
    throw new DimensionMismatchError(
      `Provider returned ${vector.length} dimensions; expected ${config.dimensions}`,
    );
  }
  if (!vector.every((component) => typeof component === 'number' && Number.isFinite(component))) {
    throw new PrismaEmbeddingSyncError(
      'Provider vector components must all be finite numbers',
      'PROVIDER_ERROR',
    );
  }
  return `[${vector.join(',')}]`;
}
