/** @file Tests Ollama request construction, validation, errors, timeout, and gated live integration. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DimensionMismatchError, OllamaProvider, PrismaEmbeddingSyncError } from '../src/index.js';

const mockedFetch = vi.fn<typeof fetch>();

describe('OllamaProvider', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    vi.stubGlobal('fetch', mockedFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the default model and inputs to /api/embed and parses vectors', async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse({
        embeddings: [
          [0.25, -0.5],
          [1, 0],
        ],
      }),
    );
    const provider = new OllamaProvider({ dimensions: 2 });

    await expect(provider.embed(['first', 'second'])).resolves.toEqual([
      [0.25, -0.5],
      [1, 0],
    ]);
    expect(provider.modelName).toBe('nomic-embed-text');
    expect(provider.dimensions).toBe(2);
    expect(mockedFetch).toHaveBeenCalledOnce();
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/embed');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'nomic-embed-text',
      input: ['first', 'second'],
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses configured URL, model, dimensions, and timeout', async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ embeddings: [[0.2, 0.1, 0]] }));
    const provider = new OllamaProvider({
      baseUrl: 'http://ollama.local:11434/',
      model: 'custom-embedder',
      dimensions: 3,
      timeoutMs: 1200,
    });

    await provider.embed(['text']);
    expect(mockedFetch.mock.calls[0][0]).toBe('http://ollama.local:11434/api/embed');
    expect(JSON.parse(String(mockedFetch.mock.calls[0][1]?.body))).toEqual({
      model: 'custom-embedder',
      input: ['text'],
    });
    expect(provider.dimensions).toBe(3);
  });

  it('rejects unknown model dimensions unless explicitly configured', () => {
    expect(() => new OllamaProvider({ model: 'another-model' })).toThrow(
      /dimensions must be specified/,
    );
    expect(() => new OllamaProvider({ dimensions: 0 })).toThrow(RangeError);
    expect(() => new OllamaProvider({ timeoutMs: 0 })).toThrow(RangeError);
  });

  it('rejects vector count mismatches', async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ embeddings: [[0, 0]] }));

    await expect(
      new OllamaProvider({ dimensions: 2 }).embed(['one', 'two']),
    ).rejects.toBeInstanceOf(DimensionMismatchError);
  });

  it('rejects dimension and non-finite component mismatches', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({ embeddings: [[0]] }));
    await expect(new OllamaProvider({ dimensions: 2 }).embed(['one'])).rejects.toBeInstanceOf(
      DimensionMismatchError,
    );

    const nonFiniteResponse = jsonResponse({ embeddings: [[0, 0]] });
    vi.spyOn(nonFiniteResponse, 'json').mockResolvedValue({ embeddings: [[0, Number.NaN]] });
    mockedFetch.mockResolvedValueOnce(nonFiniteResponse);
    await expect(new OllamaProvider({ dimensions: 2 }).embed(['one'])).rejects.toThrow(
      /non-finite component/,
    );
  });

  it('includes status and a safely truncated body for non-success responses', async () => {
    mockedFetch.mockResolvedValue(
      new Response('x'.repeat(800), { status: 503, statusText: 'Unavailable' }),
    );

    const error = await new OllamaProvider({ dimensions: 2 })
      .embed(['one'])
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(PrismaEmbeddingSyncError);
    expect((error as Error).message).toContain('HTTP 503');
    expect((error as Error).message.length).toBeLessThan(540);
  });

  it('converts timeout failures into a provider error with timeout in its message', async () => {
    mockedFetch.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));

    await expect(new OllamaProvider({ dimensions: 2 }).embed(['one'])).rejects.toThrow(/timeout/i);
  });

  it('rejects malformed JSON and response shapes', async () => {
    mockedFetch.mockResolvedValueOnce(
      new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await expect(new OllamaProvider({ dimensions: 2 }).embed(['one'])).rejects.toThrow(
      /malformed JSON/,
    );

    mockedFetch.mockResolvedValueOnce(jsonResponse({ vectors: [[0, 0]] }));
    await expect(new OllamaProvider({ dimensions: 2 }).embed(['one'])).rejects.toThrow(
      /must contain an embeddings array/,
    );
    mockedFetch.mockResolvedValueOnce(jsonResponse({ embeddings: [null] }));
    await expect(new OllamaProvider({ dimensions: 2 }).embed(['one'])).rejects.toThrow(
      /must contain an embeddings array/,
    );
  });

  it.skipIf(process.env.INTEGRATION !== '1')(
    'embeds with the configured local Ollama model',
    async () => {
      vi.unstubAllGlobals();
      const provider = new OllamaProvider();
      const [vector] = await provider.embed(['integration test']);
      expect(vector).toHaveLength(provider.dimensions);
    },
  );
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
