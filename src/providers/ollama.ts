/** @file Implements the Ollama embedding API client with timeout and vector validation. */
import { DimensionMismatchError, PrismaEmbeddingSyncError } from '../errors.js';
import type { EmbeddingProvider, OllamaProviderOptions } from '../types.js';

const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_DIMENSIONS = 768;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY_LENGTH = 500;

/** Calls Ollama's native embedding endpoint and validates its response before returning vectors. */
export class OllamaProvider implements EmbeddingProvider {
  /** Number of components expected in every response vector. */
  readonly dimensions: number;

  /** Ollama model used for embedding requests. */
  readonly modelName: string;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  /** Creates a provider for Ollama, defaulting to nomic-embed-text at localhost. */
  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
    this.modelName = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (options.dimensions === undefined && this.modelName !== DEFAULT_MODEL) {
      throw new RangeError(`dimensions must be specified for Ollama model "${this.modelName}"`);
    }
    this.dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;

    if (!Number.isInteger(this.dimensions) || this.dimensions <= 0) {
      throw new RangeError('dimensions must be a positive integer');
    }
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new RangeError('timeoutMs must be a positive integer');
    }
  }

  /** Embeds inputs using Ollama's /api/embed endpoint and validates every vector. */
  async embed(texts: string[]): Promise<number[][]> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.modelName, input: texts }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new PrismaEmbeddingSyncError(
          `Ollama embedding request timeout after ${this.timeoutMs} ms`,
          'PROVIDER_ERROR',
        );
      }
      throw new PrismaEmbeddingSyncError(
        `Ollama embedding request failed: ${errorMessage(error)}`,
        'PROVIDER_ERROR',
      );
    }

    if (!response.ok) {
      const body = truncate(await response.text(), MAX_ERROR_BODY_LENGTH);
      throw new PrismaEmbeddingSyncError(
        `Ollama returned HTTP ${response.status}: ${body}`,
        'PROVIDER_ERROR',
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new PrismaEmbeddingSyncError(
        `Ollama returned malformed JSON: ${errorMessage(error)}`,
        'PROVIDER_ERROR',
      );
    }

    const embeddings = readEmbeddings(payload);
    if (embeddings === null) {
      throw new PrismaEmbeddingSyncError(
        'Ollama response must contain an embeddings array',
        'PROVIDER_ERROR',
      );
    }
    if (embeddings.length !== texts.length) {
      throw new DimensionMismatchError(
        `Ollama returned ${embeddings.length} vectors for ${texts.length} inputs`,
      );
    }

    for (const [index, vector] of embeddings.entries()) {
      if (vector.length !== this.dimensions) {
        throw new DimensionMismatchError(
          `Ollama vector ${index} has ${vector.length} dimensions; expected ${this.dimensions}`,
        );
      }
      if (!vector.every(Number.isFinite)) {
        throw new PrismaEmbeddingSyncError(
          `Ollama vector ${index} contains a non-finite component`,
          'PROVIDER_ERROR',
        );
      }
    }

    return embeddings;
  }
}

function readEmbeddings(payload: unknown): number[][] | null {
  if (typeof payload !== 'object' || payload === null || !('embeddings' in payload)) {
    return null;
  }

  const embeddings = payload.embeddings;
  if (
    !Array.isArray(embeddings) ||
    !embeddings.every(
      (vector: unknown): vector is number[] =>
        Array.isArray(vector) &&
        vector.every((component: unknown) => typeof component === 'number'),
    )
  ) {
    return null;
  }

  return embeddings;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' ||
      error.name === 'AbortError' ||
      /timed? ?out/i.test(error.message))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, maximumLength: number): string {
  return value.length <= maximumLength ? value : `${value.slice(0, maximumLength)}…`;
}
