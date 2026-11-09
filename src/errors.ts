/** @file Defines stable, typed errors that consumers can use to handle package failures. */

/** Base error for failures raised by prisma-embedding-sync. */
export class PrismaEmbeddingSyncError extends Error {
  /** Stable machine-readable error code. */
  readonly code: string;

  /** Creates a package error with a stable code and human-readable message. */
  constructor(message: string, code: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Indicates that the supplied embedding configuration is invalid. */
export class ConfigValidationError extends PrismaEmbeddingSyncError {
  /** Creates a configuration error with the stable CONFIG_VALIDATION code. */
  constructor(message: string) {
    super(message, 'CONFIG_VALIDATION');
  }
}

/** Indicates that a provider returned a vector with an unexpected shape. */
export class DimensionMismatchError extends PrismaEmbeddingSyncError {
  /** Creates a dimension error with the stable DIMENSION_MISMATCH code. */
  constructor(message: string) {
    super(message, 'DIMENSION_MISMATCH');
  }
}

/** Indicates that a requested Prisma operation is outside the supported contract. */
export class UnsupportedOperationError extends PrismaEmbeddingSyncError {
  /** Creates an operation error with the stable UNSUPPORTED_OPERATION code. */
  constructor(message: string) {
    super(message, 'UNSUPPORTED_OPERATION');
  }
}
