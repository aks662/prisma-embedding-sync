/** @file Normalizes configured source values and computes their deterministic SHA-256 hash. */
import { createHash } from 'node:crypto';

/** Converts configured scalar fields to the canonical text used by both hashing and embedding. */
export function normalizeSourceFields(
  data: Record<string, unknown>,
  sourceFields: string[],
): string {
  const normalizedValues = sourceFields
    .map((field) => normalizeValue(data[field], field))
    .filter((value) => value.length > 0);

  return normalizedValues.join(' ');
}

/** Returns the lowercase hexadecimal SHA-256 digest of the supplied text. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Hashes the canonical, ordered text produced from the selected source fields. */
export function hashSourceFields(data: Record<string, unknown>, sourceFields: string[]): string {
  return sha256(normalizeSourceFields(data, sourceFields));
}

function normalizeValue(value: unknown, field: string): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Source field "${field}" must contain a finite number`);
    }
    return String(value).trim();
  }

  if (typeof value === 'boolean') {
    return String(value);
  }

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new TypeError(`Source field "${field}" must contain a valid Date`);
    }
    return value.toISOString();
  }

  throw new TypeError(
    `Source field "${field}" must be a string, finite number, boolean, Date, null, or undefined`,
  );
}
