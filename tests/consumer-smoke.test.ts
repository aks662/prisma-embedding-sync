/** @file Verifies ESM, CJS, and type consumers load the generated package entry points. */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type {
  EmbedConfig,
  EmbeddingProvider,
  ModelEmbedConfig,
  OllamaProviderOptions,
} from 'prisma-embedding-sync';

describe('built package consumer entry points', () => {
  it('imports public runtime exports through the ESM package export', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { withEmbeddings, sha256, hashSourceFields, MockProvider, OllamaProvider, ConfigValidationError, DimensionMismatchError, PrismaEmbeddingSyncError, UnsupportedOperationError } from 'prisma-embedding-sync';
if ([withEmbeddings, sha256, hashSourceFields, MockProvider, OllamaProvider, ConfigValidationError, DimensionMismatchError, PrismaEmbeddingSyncError, UnsupportedOperationError].some((item) => typeof item !== 'function')) process.exit(1);
process.stdout.write('esm-ok');`,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('esm-ok');
  });

  it('requires public runtime exports through the CommonJS package export', () => {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `const { withEmbeddings, sha256, hashSourceFields, MockProvider, OllamaProvider, ConfigValidationError, DimensionMismatchError, PrismaEmbeddingSyncError, UnsupportedOperationError } = require('prisma-embedding-sync');
if ([withEmbeddings, sha256, hashSourceFields, MockProvider, OllamaProvider, ConfigValidationError, DimensionMismatchError, PrismaEmbeddingSyncError, UnsupportedOperationError].some((item) => typeof item !== 'function')) process.exit(1);
process.stdout.write('cjs-ok');`,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('cjs-ok');
  });

  it('resolves the public type declarations using the package export map', () => {
    const provider: EmbeddingProvider = {
      dimensions: 3,
      modelName: 'consumer-smoke',
      embed: async (texts: string[]): Promise<number[][]> => texts.map(() => [0, 0, 0]),
    };
    const model: ModelEmbedConfig = {
      sourceFields: ['name'],
      targetField: 'embedding',
      provider,
      dimensions: 3,
    };
    const config: EmbedConfig = { models: { Product: model } };
    const ollamaOptions: OllamaProviderOptions = { model: 'nomic-embed-text', dimensions: 768 };

    expect(config.models.Product.provider).toBe(provider);
    expect(ollamaOptions.dimensions).toBe(768);
  });
});
