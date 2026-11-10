/** @file Tests all required configuration errors and construction of the pass-through extension. */
import { describe, expect, it, vi } from 'vitest';
import { ConfigValidationError, withEmbeddings } from '../src/index.js';
import { validateConfig } from '../src/config.js';
import type { EmbedConfig } from '../src/types.js';

describe('extension configuration validation', () => {
  it('V1 requires a config object', () => {
    expect(() => validateConfig(asEmbedConfig(null))).toThrow(
      new ConfigValidationError('config is required'),
    );
    expect(() => validateConfig(asEmbedConfig(undefined))).toThrow(
      new ConfigValidationError('config is required'),
    );
  });

  it('V2 requires at least one configured model', () => {
    expect(() => validateConfig(asEmbedConfig({ models: {} }))).toThrow(
      new ConfigValidationError('config.models must have at least one model'),
    );
    expect(() => validateConfig(asEmbedConfig({ models: [] }))).toThrow(
      new ConfigValidationError('config.models must have at least one model'),
    );
  });

  it('V3 requires non-empty string source fields and rejects duplicates', () => {
    expect(() => validateConfig(asEmbedConfig({ models: { Product: {} } }))).toThrow(
      new ConfigValidationError('Model "Product": sourceFields must contain at least one field'),
    );
    expect(() => validateConfig(configWith({ sourceFields: ['name', ' '] }))).toThrow(
      new ConfigValidationError('Model "Product": sourceFields must contain at least one field'),
    );
    expect(() => validateConfig(configWith({ sourceFields: ['name', 'name'] }))).toThrow(
      new ConfigValidationError('Model "Product": sourceFields must not contain duplicates'),
    );
  });

  it('V4 requires a non-blank target field and distinct target/hash fields', () => {
    expect(() => validateConfig(configWith({ targetField: '  ' }))).toThrow(
      new ConfigValidationError('Model "Product": targetField is required'),
    );
    expect(() => validateConfig(configWith({ hashField: 'embedding' }))).toThrow(
      new ConfigValidationError('Model "Product": targetField and hashField must be distinct'),
    );
    expect(() => validateConfig(configWith({ hashField: 'name' }))).toThrow(
      new ConfigValidationError('Model "Product": targetField and hashField must be distinct'),
    );
    expect(() => validateConfig(configWith({ hashField: '' }))).toThrow(
      new ConfigValidationError('Model "Product": hashField must be a non-empty field name'),
    );
    expect(() => validateConfig(configWith({ sourceFields: ['name', 'embeddingInput'] }))).toThrow(
      new ConfigValidationError(
        'Model "Product": sourceFields and hashField must not include staging field "embeddingInput"',
      ),
    );
    expect(() => validateConfig(configWith({ hashField: 'embeddingInput' }))).toThrow(
      new ConfigValidationError(
        'Model "Product": sourceFields and hashField must not include staging field "embeddingInput"',
      ),
    );
  });

  it('V5 requires a provider with callable embed and a finite positive dimension', () => {
    expect(() => validateConfig(configWith({ provider: undefined }))).toThrow(
      new ConfigValidationError('Model "Product": provider is required'),
    );
    expect(() => validateConfig(configWith({ provider: { dimensions: 8 } }))).toThrow(
      new ConfigValidationError('Model "Product": provider is required'),
    );
    expect(() =>
      validateConfig(configWith({ provider: providerWithDimensions(Number.NaN) })),
    ).toThrow(new ConfigValidationError('Model "Product": provider is required'));
  });

  it('V6 requires provider and model dimensions to match', () => {
    expect(() =>
      validateConfig(configWith({ provider: providerWithDimensions(4), dimensions: 8 })),
    ).toThrow(
      new ConfigValidationError(
        'Model "Product": provider.dimensions (4) must match dimensions (8)',
      ),
    );
  });

  it('V7 requires model dimensions to be a positive integer', () => {
    expect(() => validateConfig(configWith({ dimensions: 0 }))).toThrow(
      new ConfigValidationError('Model "Product": dimensions must be a positive integer'),
    );
    expect(() => validateConfig(configWith({ dimensions: 2.5 }))).toThrow(
      new ConfigValidationError('Model "Product": dimensions must be a positive integer'),
    );
    expect(() =>
      validateConfig(
        configWith({ dimensions: Number.POSITIVE_INFINITY, provider: providerWithDimensions(8) }),
      ),
    ).toThrow(new ConfigValidationError('Model "Product": dimensions must be a positive integer'));
  });

  it('V8 rejects source fields that include the vector target', () => {
    expect(() => validateConfig(configWith({ sourceFields: ['name', 'embedding'] }))).toThrow(
      new ConfigValidationError('Model "Product": sourceFields must not include targetField'),
    );
  });

  it('accepts a valid config and returns a version-neutral Prisma extension', async () => {
    validateConfig(validConfig());
    const extension = withEmbeddings(validConfig());

    expect(Object.keys(extension.query.$allModels).sort()).toEqual([
      'create',
      'createMany',
      'update',
      'updateMany',
      'upsert',
    ]);

    const data = { data: { name: 'Keyboard' } };
    const result = { id: 1, name: 'Keyboard' };
    const query = vi.fn(async (args: typeof data) => {
      expect(args).toBe(data);
      return result;
    });

    await expect(
      extension.query.$allModels.create({ model: 'Unconfigured', args: data, query }),
    ).resolves.toBe(result);
    expect(query).toHaveBeenCalledOnce();
  });
});

function validConfig(): EmbedConfig {
  return {
    models: {
      Product: {
        sourceFields: ['name'],
        targetField: 'embedding',
        provider: providerWithDimensions(8),
        dimensions: 8,
      },
    },
  };
}

function configWith(overrides: Record<string, unknown>): EmbedConfig {
  const model = { ...validConfig().models.Product, ...overrides };
  return { models: { Product: model as EmbedConfig['models'][string] } };
}

function providerWithDimensions(dimensions: number): EmbedConfig['models'][string]['provider'] {
  return {
    dimensions,
    modelName: 'test',
    embed: async (texts: string[]): Promise<number[][]> =>
      texts.map(() => Array.from({ length: dimensions }, () => 0)),
  };
}

function asEmbedConfig(value: unknown): EmbedConfig {
  return value as EmbedConfig;
}
