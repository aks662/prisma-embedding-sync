/** @file Defines the public configuration and provider contracts for embedding synchronization. */
import type { EmbeddingProvider } from './providers/interface.js';

export type { EmbeddingProvider } from './providers/interface.js';

/** Options for constructing a deterministic mock embedding provider. */
export interface MockProviderOptions {
  /** Number of values expected in each generated vector. */
  dimensions?: number;
}

/** Options for connecting an embedding provider to an Ollama server. */
export interface OllamaProviderOptions {
  /** Base URL of the Ollama HTTP API. Defaults to http://localhost:11434. */
  baseUrl?: string;
  /** Ollama model name. Defaults to nomic-embed-text. */
  model?: string;
  /** Request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** Expected vector size. Defaults to 768 for nomic-embed-text. */
  dimensions?: number;
}

/** Embedding behavior for one Prisma schema model. */
export interface ModelEmbedConfig {
  /** Scalar fields whose normalized values are embedded and hashed. */
  sourceFields: string[];
  /** Prisma field name that stores the embedding vector. */
  targetField: string;
  /** Field that stores the source hash; defaults to `${targetField}Hash`. */
  hashField?: string;
  /** Provider used to create vectors for this model. */
  provider: EmbeddingProvider;
  /** Expected number of components in vectors for this model. */
  dimensions: number;
}

/** Configuration for all model-specific embedding synchronization rules. */
export interface EmbedConfig {
  /** Embedding settings keyed by Prisma schema model name. */
  models: Record<string, ModelEmbedConfig>;
  /** Optional structured logger; omitted calls are intentionally silent. */
  logger?: (message: string, meta?: Record<string, unknown>) => void;
}
