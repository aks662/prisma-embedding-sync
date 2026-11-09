/** @file Implements hash-guarded scalar updates for configured embedding models. */
import { UnsupportedOperationError } from '../errors.js';
import { normalizeSourceFields, sha256 } from '../hash.js';
import type { ModelEmbedConfig } from '../types.js';
import { injectNormalizedEmbedding } from './inject.js';

/**
 * Runs supported scalar updates. Source changes require the caller's current embedding hash
 * in `where`; PostgreSQL then uses that hash as an optimistic concurrency guard in the same
 * mutation that writes source fields, staging input, hash, and trigger-backed vector.
 */
export async function executeUpdate<TArgs extends { where: unknown; data: unknown }, TResult>(
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

  const data = requireRecord(
    args.data,
    `update for model "${modelName}" requires a plain data object`,
  );
  assertSupportedScalarData(data, config, modelName);
  const sourceFieldsPresent = config.sourceFields.filter((field) => Object.hasOwn(data, field));
  if (sourceFieldsPresent.length === 0) {
    return query(args);
  }
  if (sourceFieldsPresent.length !== config.sourceFields.length) {
    throw unsupported(
      modelName,
      `source updates must provide every configured source field (${config.sourceFields.join(', ')})`,
    );
  }

  const hashField = config.hashField ?? `${config.targetField}Hash`;
  const where = requireRecord(
    args.where,
    `update for model "${modelName}" requires a plain where object`,
  );
  if (
    !Object.hasOwn(where, hashField) ||
    (where[hashField] !== null && typeof where[hashField] !== 'string')
  ) {
    throw unsupported(
      modelName,
      `source updates must include the current ${hashField} value in where for optimistic concurrency control`,
    );
  }

  const sourceText = normalizeSourceFields(data, config.sourceFields);
  const nextHash = sourceText.length === 0 ? null : sha256(sourceText);
  if (nextHash === where[hashField]) {
    return query(args);
  }

  const staged = await injectNormalizedEmbedding(data, config, sourceText);
  const nextArgs = { ...args, data: staged } as TArgs;
  return query(nextArgs);
}

function assertSupportedScalarData(
  data: Record<string, unknown>,
  config: ModelEmbedConfig,
  model: string,
): void {
  const reserved = new Set([
    config.targetField,
    `${config.targetField}Input`,
    config.hashField ?? `${config.targetField}Hash`,
  ]);
  for (const [field, value] of Object.entries(data)) {
    if (reserved.has(field)) {
      throw unsupported(model, `field "${field}" is managed by the embedding extension`);
    }
    if (value === undefined) {
      throw unsupported(
        model,
        `field "${field}" must not be undefined; omit unchanged fields explicitly`,
      );
    }
    if (Array.isArray(value) || isPlainObject(value)) {
      throw unsupported(
        model,
        `field "${field}" uses an unsupported atomic, nested, JSON, or array update; use direct scalar values`,
      );
    }
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean' &&
      !(value instanceof Date)
    ) {
      throw unsupported(model, `field "${field}" must use a direct scalar update value`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw unsupported(model, `field "${field}" must use a finite number`);
    }
    if (value instanceof Date && !Number.isFinite(value.getTime())) {
      throw unsupported(model, `field "${field}" must use a valid Date`);
    }
  }
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new UnsupportedOperationError(message);
  }
  return value;
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

function unsupported(model: string, detail: string): UnsupportedOperationError {
  return new UnsupportedOperationError(`update for model "${model}" is unsupported: ${detail}`);
}
