/** @file Verifies that the public type and error contracts can be imported and instantiated. */
import { describe, expect, it } from 'vitest';
import {
  ConfigValidationError,
  DimensionMismatchError,
  PrismaEmbeddingSyncError,
  UnsupportedOperationError,
} from '../src/index.js';
import type {
  EmbedConfig,
  EmbeddingProvider,
  MockProviderOptions,
  ModelEmbedConfig,
  OllamaProviderOptions,
} from '../src/index.js';

describe('public type and error contracts', () => {
  it('allows all public configuration and provider types to be used', () => {
    const provider: EmbeddingProvider = {
      dimensions: 8,
      modelName: 'smoke',
      embed: async (texts: string[]): Promise<number[][]> =>
        texts.map(() => Array.from({ length: 8 }, () => 0)),
    };
    const model: ModelEmbedConfig = {
      sourceFields: ['name'],
      targetField: 'embedding',
      provider,
      dimensions: 8,
    };
    const config: EmbedConfig = { models: { Product: model } };
    const mockOptions: MockProviderOptions = { dimensions: 8 };
    const ollamaOptions: OllamaProviderOptions = { dimensions: 768 };

    expect(config.models.Product).toBe(model);
    expect(mockOptions.dimensions).toBe(8);
    expect(ollamaOptions.dimensions).toBe(768);
  });

  it('creates all public error classes with stable codes', () => {
    const errors = [
      new PrismaEmbeddingSyncError('base', 'BASE'),
      new ConfigValidationError('config'),
      new DimensionMismatchError('dimension'),
      new UnsupportedOperationError('operation'),
    ];

    expect(errors.map((error) => error.code)).toEqual([
      'BASE',
      'CONFIG_VALIDATION',
      'DIMENSION_MISMATCH',
      'UNSUPPORTED_OPERATION',
    ]);
    expect(errors.every((error) => error instanceof Error)).toBe(true);
  });
});
