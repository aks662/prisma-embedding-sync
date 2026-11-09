/** @file Tests deterministic mock vector generation, call counting, and injected failures. */
import { describe, expect, it } from 'vitest';
import { MockProvider } from '../src/index.js';

describe('MockProvider', () => {
  it('returns stable vectors for repeated text and different vectors for different fixtures', async () => {
    const provider = new MockProvider();
    const first = await provider.embed(['tactile keyboard']);
    const repeated = await provider.embed(['tactile keyboard']);
    const different = await provider.embed(['wireless mouse']);

    expect(repeated[0]).toEqual(first[0]);
    expect(different[0]).not.toEqual(first[0]);
    expect(provider.modelName).toBe('mock');
  });

  it('uses the default dimension and keeps all vector values finite and bounded', async () => {
    const [vector] = await new MockProvider().embed(['a product description']);

    expect(vector).toHaveLength(8);
    expect(vector.every((component) => Number.isFinite(component))).toBe(true);
    expect(vector.every((component) => component >= -1 && component <= 1)).toBe(true);
  });

  it('supports configured dimensions beyond one SHA-256 block', async () => {
    const provider = new MockProvider({ dimensions: 40 });
    const [first] = await provider.embed(['expanded vector']);
    const [second] = await provider.embed(['expanded vector']);

    expect(first).toHaveLength(40);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(8);
  });

  it('counts input texts and throws a configured failure exactly once', async () => {
    const provider = new MockProvider();
    const failure = new Error('planned failure');
    provider.failNextWith = failure;

    await expect(provider.embed(['one', 'two'])).rejects.toBe(failure);
    expect(provider.embedCallCount).toBe(2);
    expect(provider.failNextWith).toBeNull();
    await expect(provider.embed(['three'])).resolves.toHaveLength(1);
    expect(provider.embedCallCount).toBe(3);
  });

  it('rejects non-positive or non-integer dimensions', () => {
    expect(() => new MockProvider({ dimensions: 0 })).toThrow(RangeError);
    expect(() => new MockProvider({ dimensions: 1.5 })).toThrow(RangeError);
  });
});
