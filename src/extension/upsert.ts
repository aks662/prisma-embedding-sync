/** @file Prepares safe scalar upserts for PostgreSQL's native conflict-handling path. */
import { UnsupportedOperationError } from '../errors.js';
import type { ModelEmbedConfig } from '../types.js';
import { injectEmbeddings } from './inject.js';

/** Executes a configured native upsert after staging any create and source-update embeddings. */
export async function executeUpsert<
  TArgs extends { where: unknown; create: unknown; update: unknown },
  TResult,
>(
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
  const where = requireRecord(args.where, modelName, 'where');
  const create = requireRecord(args.create, modelName, 'create');
  const update = requireRecord(args.update, modelName, 'update');

  const whereEntries = Object.entries(where);
  if (whereEntries.length !== 1) {
    throw unsupported(modelName, 'where must contain one direct unique selector');
  }
  const [selector, selectorValue] = whereEntries[0]!;
  assertScalar(selectorValue, modelName, `where.${selector}`);
  if (!Object.hasOwn(create, selector) || !Object.is(create[selector], selectorValue)) {
    throw unsupported(
      modelName,
      `create.${selector} must match where.${selector} so Prisma can use a database-native upsert`,
    );
  }
  validateData(create, config, modelName, 'create');
  validateData(update, config, modelName, 'update');
  if (Object.hasOwn(update, selector)) {
    throw unsupported(modelName, `update must not modify the unique selector "${selector}"`);
  }
  if (Object.keys(update).length === 0) {
    throw unsupported(modelName, 'update must include at least one scalar field');
  }

  const updateSourcesPresent = config.sourceFields.filter((field) => Object.hasOwn(update, field));
  if (
    updateSourcesPresent.length > 0 &&
    updateSourcesPresent.length !== config.sourceFields.length
  ) {
    throw unsupported(
      modelName,
      `source updates must provide every configured source field (${config.sourceFields.join(', ')})`,
    );
  }

  const upsertRows: Record<string, unknown>[] = [create];
  const updateIndex = updateSourcesPresent.length === 0 ? undefined : upsertRows.push(update) - 1;
  const stagedRows = await injectEmbeddings(upsertRows, config);
  const stagedCreate = stagedRows[0]!;
  const stagedUpdate = updateIndex === undefined ? update : stagedRows[updateIndex]!;
  const nextArgs = { ...args, create: stagedCreate, update: stagedUpdate } as TArgs;
  return query(nextArgs);
}

function validateData(
  data: Record<string, unknown>,
  config: ModelEmbedConfig,
  model: string,
  branch: 'create' | 'update',
): void {
  const managedFields = new Set([
    config.targetField,
    `${config.targetField}Input`,
    config.hashField ?? `${config.targetField}Hash`,
  ]);
  for (const [field, value] of Object.entries(data)) {
    if (managedFields.has(field)) {
      throw unsupported(model, `${branch}.${field} is managed by the embedding extension`);
    }
    assertScalar(value, model, `${branch}.${field}`);
  }
}

function assertScalar(value: unknown, model: string, path: string): void {
  if (
    value === undefined ||
    Array.isArray(value) ||
    isPlainObject(value) ||
    (value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean' &&
      !(value instanceof Date))
  ) {
    throw unsupported(model, `${path} must use a direct scalar value`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw unsupported(model, `${path} must be a finite number`);
  }
  if (value instanceof Date && !Number.isFinite(value.getTime())) {
    throw unsupported(model, `${path} must be a valid Date`);
  }
}

function requireRecord(value: unknown, model: string, branch: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw unsupported(model, `${branch} must be a plain object`);
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
  return new UnsupportedOperationError(`upsert for model "${model}" is unsupported: ${detail}`);
}
