/** @file Implements a stable local embedding provider for deterministic tests and examples. */
import { createHash } from 'node:crypto';
import type { EmbeddingProvider, MockProviderOptions } from '../types.js';

/** Generates deterministic, bounded vectors without network access. */
export class MockProvider implements EmbeddingProvider {
  /** Number of input texts processed by embed, including calls that are forced to fail. */
  embedCallCount = 0;

  /** Optional error thrown by the next embed call, then cleared automatically. */
  failNextWith: Error | null = null;

  /** Number of components in every generated vector. */
  readonly dimensions: number;

  /** Stable identifier for this deterministic provider. */
  readonly modelName = 'mock';

  /** Creates the mock provider, defaulting to eight vector dimensions. */
  constructor(options: MockProviderOptions = {}) {
    this.dimensions = options.dimensions ?? 8;
    if (!Number.isInteger(this.dimensions) || this.dimensions <= 0) {
      throw new RangeError('dimensions must be a positive integer');
    }
  }

  /** Returns one deterministic vector per text and supports a one-shot injected failure. */
  async embed(texts: string[]): Promise<number[][]> {
    this.embedCallCount += texts.length;
    if (this.failNextWith !== null) {
      const error = this.failNextWith;
      this.failNextWith = null;
      throw error;
    }

    return texts.map((text) => this.createVector(text));
  }

  private createVector(text: string): number[] {
    const vector: number[] = [];
    let block = 0;

    while (vector.length < this.dimensions) {
      const digest = createHash('sha256').update(`${block}\0${text}`, 'utf8').digest();
      for (let offset = 0; offset < digest.length && vector.length < this.dimensions; offset += 4) {
        const unsignedValue = digest.readUInt32BE(offset);
        vector.push((unsignedValue / 0xffffffff) * 2 - 1);
      }
      block += 1;
    }

    return vector;
  }
}
