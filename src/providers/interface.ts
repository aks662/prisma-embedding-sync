/** @file Houses the provider interface shared by real and deterministic embedding providers. */

/** Common contract implemented by providers that return fixed-size embedding vectors. */
export interface EmbeddingProvider {
  /** Embeds each input string and returns one vector per input. */
  embed(texts: string[]): Promise<number[][]>;
  /** Number of components returned in each vector. */
  readonly dimensions: number;
  /** Human-readable provider or model identifier. */
  readonly modelName: string;
}
