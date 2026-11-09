/** @file Prepares one configured Prisma create payload before its single underlying mutation. */
import { UnsupportedOperationError } from '../errors.js';
import { injectEmbedding } from './inject.js';
import type { ModelEmbedConfig } from '../types.js';

/** Executes a create query after injecting vector input and source hash for configured models. */
export async function executeCreate<TArgs extends { data: unknown }, TResult>(
  model: string | undefined,
  args: TArgs,
  query: (args: TArgs) => PromiseLike<TResult>,
  modelConfigs: Record<string, ModelEmbedConfig>,
): Promise<TResult> {
  const config = model === undefined ? undefined : modelConfigs[model];
  if (config === undefined) {
    return query(args);
  }

  const data: unknown = args.data;
  if (Array.isArray(data)) {
    throw new UnsupportedOperationError(
      `create for model "${model}" does not accept array data; use createMany for multiple rows`,
    );
  }
  if (!isRecord(data)) {
    throw new UnsupportedOperationError(`create for model "${model}" requires a plain data object`);
  }
  if (containsUnsupportedNestedValue(data)) {
    throw new UnsupportedOperationError(
      `create for model "${model}" does not support nested relation, JSON object, or array values`,
    );
  }

  const injectedData = await injectEmbedding(data, config);
  const nextArgs = { ...args, data: injectedData } as TArgs;
  return query(nextArgs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsUnsupportedNestedValue(data: Record<string, unknown>): boolean {
  return Object.values(data).some((value) => Array.isArray(value) || isPlainObject(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
