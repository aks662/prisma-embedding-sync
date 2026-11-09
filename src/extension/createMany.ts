/** @file Prepares batched create payloads with stable input-to-embedding index mapping. */
import { UnsupportedOperationError } from '../errors.js';
import { injectEmbeddings } from './inject.js';
import type { ModelEmbedConfig } from '../types.js';

/** Executes one configured createMany mutation after validating and staging every input row. */
export async function executeCreateMany<TArgs extends { data: unknown }, TResult>(
  model: string | undefined,
  args: TArgs,
  query: (args: TArgs) => PromiseLike<TResult>,
  modelConfigs: Record<string, ModelEmbedConfig>,
): Promise<TResult> {
  const config = model === undefined ? undefined : modelConfigs[model];
  if (config === undefined) {
    return query(args);
  }
  const modelName = model ?? 'unknown';

  const inputData: unknown = args.data;
  const isArrayInput = Array.isArray(inputData);
  const inputRows: unknown[] = isArrayInput ? inputData : [inputData];
  if (inputRows.length === 0) {
    return query(args);
  }
  const rows = inputRows.map((row, originalIndex) =>
    validateRow(row, config, modelName, originalIndex),
  );
  const stagedRows = await injectEmbeddings(rows, config);
  const nextData = isArrayInput ? stagedRows : stagedRows[0];
  const nextArgs = { ...args, data: nextData } as TArgs;
  return query(nextArgs);
}

function validateRow(
  row: unknown,
  config: ModelEmbedConfig,
  model: string,
  originalIndex: number,
): Record<string, unknown> {
  if (!isRecord(row)) {
    throw new UnsupportedOperationError(
      `createMany for model "${model}" expected a plain object at row ${originalIndex}`,
    );
  }

  const managedFields = new Set([
    config.targetField,
    `${config.targetField}Input`,
    config.hashField ?? `${config.targetField}Hash`,
  ]);
  for (const [field, value] of Object.entries(row)) {
    if (managedFields.has(field)) {
      throw new UnsupportedOperationError(
        `createMany for model "${model}" cannot set extension-managed field "${field}"`,
      );
    }
    if (Array.isArray(value) || isPlainObject(value)) {
      throw new UnsupportedOperationError(
        `createMany for model "${model}" does not support nested, JSON, or array values (row ${originalIndex}, field "${field}")`,
      );
    }
    if (
      value === undefined ||
      (value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean' &&
        !(value instanceof Date))
    ) {
      throw new UnsupportedOperationError(
        `createMany for model "${model}" requires direct scalar values (row ${originalIndex}, field "${field}")`,
      );
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new UnsupportedOperationError(
        `createMany for model "${model}" requires finite numbers (row ${originalIndex}, field "${field}")`,
      );
    }
    if (value instanceof Date && !Number.isFinite(value.getTime())) {
      throw new UnsupportedOperationError(
        `createMany for model "${model}" requires valid dates (row ${originalIndex}, field "${field}")`,
      );
    }
  }
  return row;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
