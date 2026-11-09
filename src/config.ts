/** @file Validates model embedding configuration synchronously before client extension. */
import { ConfigValidationError } from './errors.js';
import type { EmbedConfig, ModelEmbedConfig } from './types.js';

/** Checks that the embedding configuration is complete and internally consistent. */
export function validateConfig(config: EmbedConfig): void {
  if (!isRecord(config)) {
    throw new ConfigValidationError('config is required');
  }

  const models = config.models;
  if (!isRecord(models) || Object.keys(models).length === 0) {
    throw new ConfigValidationError('config.models must have at least one model');
  }

  for (const [modelName, rawModelConfig] of Object.entries(models)) {
    validateModelConfig(modelName, rawModelConfig);
  }
}

function validateModelConfig(modelName: string, value: unknown): asserts value is ModelEmbedConfig {
  const model = isRecord(value) ? value : {};
  const sourceFields = model.sourceFields;
  if (
    !Array.isArray(sourceFields) ||
    sourceFields.length === 0 ||
    !sourceFields.every((field) => typeof field === 'string' && field.trim().length > 0)
  ) {
    throw new ConfigValidationError(
      `Model "${modelName}": sourceFields must contain at least one field`,
    );
  }
  if (new Set(sourceFields).size !== sourceFields.length) {
    throw new ConfigValidationError(
      `Model "${modelName}": sourceFields must not contain duplicates`,
    );
  }

  const targetField = model.targetField;
  if (typeof targetField !== 'string' || targetField.trim().length === 0) {
    throw new ConfigValidationError(`Model "${modelName}": targetField is required`);
  }

  const provider = model.provider;
  if (
    !isRecord(provider) ||
    typeof provider.embed !== 'function' ||
    typeof provider.dimensions !== 'number' ||
    !Number.isFinite(provider.dimensions) ||
    provider.dimensions <= 0
  ) {
    throw new ConfigValidationError(`Model "${modelName}": provider is required`);
  }

  const dimensions = model.dimensions;
  if (typeof dimensions !== 'number' || !Number.isInteger(dimensions) || dimensions <= 0) {
    throw new ConfigValidationError(`Model "${modelName}": dimensions must be a positive integer`);
  }
  if (provider.dimensions !== dimensions) {
    throw new ConfigValidationError(
      `Model "${modelName}": provider.dimensions (${provider.dimensions}) must match dimensions (${dimensions})`,
    );
  }

  if (sourceFields.includes(targetField)) {
    throw new ConfigValidationError(
      `Model "${modelName}": sourceFields must not include targetField`,
    );
  }

  const hashField = model.hashField ?? `${targetField}Hash`;
  if (typeof hashField !== 'string' || hashField.trim().length === 0) {
    throw new ConfigValidationError(
      `Model "${modelName}": hashField must be a non-empty field name`,
    );
  }
  if (hashField === targetField || sourceFields.includes(hashField)) {
    throw new ConfigValidationError(
      `Model "${modelName}": targetField and hashField must be distinct`,
    );
  }
  const inputField = `${targetField}Input`;
  if (hashField === inputField || sourceFields.includes(inputField)) {
    throw new ConfigValidationError(
      `Model "${modelName}": sourceFields and hashField must not include staging field "${inputField}"`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
