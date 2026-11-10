/** @file Package entry point exposing public types and errors as implementation phases complete. */
export {
  ConfigValidationError,
  DimensionMismatchError,
  PrismaEmbeddingSyncError,
  UnsupportedOperationError,
} from './errors.js';
export { MockProvider } from './providers/mock.js';
export { OllamaProvider } from './providers/ollama.js';
export { withEmbeddings } from './extension/index.js';
export { hashSourceFields, sha256 } from './hash.js';
export type {
  EmbedConfig,
  EmbeddingExtension,
  EmbeddingProvider,
  EmbeddingQueryContext,
  MockProviderOptions,
  ModelEmbedConfig,
  OllamaProviderOptions,
} from './types.js';
