/** @file Rejects bulk updates because they cannot apply per-row embedding concurrency rules. */
import { UnsupportedOperationError } from '../errors.js';

/** Throws before any query or provider work for the deliberately unsupported updateMany API. */
export function rejectUpdateMany(model: string | undefined): never {
  throw new UnsupportedOperationError(
    `updateMany for model "${model ?? 'unknown'}" is not supported in v0.1 because embeddings require per-row updates; use update for one row at a time`,
  );
}
