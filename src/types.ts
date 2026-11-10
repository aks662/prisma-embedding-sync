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

/** Query arguments supplied to a generic Prisma model extension hook. */
export interface EmbeddingQueryContext<TArgs, TResult> {
  /** Prisma schema model name, when the hook is model-specific. */
  model?: string;
  /** Original Prisma operation arguments. */
  args: TArgs;
  /** Runs the underlying operation with the supplied arguments. */
  query: (args: TArgs) => PromiseLike<TResult>;
}

/** Version-neutral query extension consumed by the caller's generated Prisma Client. */
export interface EmbeddingExtension {
  /** Stable extension name visible in Prisma extension diagnostics. */
  readonly name: 'prisma-embedding-sync';
  /** Hooks for supported operations on every Prisma model. */
  readonly query: {
    readonly $allModels: {
      create<TArgs extends { data: unknown }, TResult>(
        context: EmbeddingQueryContext<TArgs, TResult>,
      ): Promise<TResult>;
      update<TArgs extends { where: unknown; data: unknown }, TResult>(
        context: EmbeddingQueryContext<TArgs, TResult>,
      ): Promise<TResult>;
      createMany<TArgs extends { data: unknown }, TResult>(
        context: EmbeddingQueryContext<TArgs, TResult>,
      ): Promise<TResult>;
      upsert<TArgs extends { where: unknown; create: unknown; update: unknown }, TResult>(
        context: EmbeddingQueryContext<TArgs, TResult>,
      ): Promise<TResult>;
      updateMany<TArgs, TResult>(context: EmbeddingQueryContext<TArgs, TResult>): Promise<never>;
    };
  };
}
