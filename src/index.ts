/** @file Package entry point exposing public types and errors as implementation phases complete. */
export {
  ConfigValidationError,
  DimensionMismatchError,
  PrismaEmbeddingSyncError,
  UnsupportedOperationError,
} from './errors.js';
export type {
  EmbedConfig,
  EmbeddingProvider,
  MockProviderOptions,
  ModelEmbedConfig,
  OllamaProviderOptions,
} from './types.js';
