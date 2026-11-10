# Changelog

All notable changes to `prisma-embedding-sync` are recorded here.

## [0.1.1] - 2026-11-10

### Changed

- Added npm repository, project homepage, and issue-tracker URL metadata; no API or runtime behavior changes.

## [0.1.0] - 2026-11-10

### Added

- Prisma Client extension hooks for `create`, `createMany`, `update`, and `upsert`.
- Source-field normalization and SHA-256 dirty checking to avoid unnecessary provider calls.
- Ollama and deterministic mock embedding providers.
- PostgreSQL and pgvector staging-column trigger integration for inline vector persistence.
- An explicit `updateMany` guard that throws `UnsupportedOperationError` before mutation.
- ESM, CommonJS, and TypeScript declaration package entry points.
- An isolated Express and vanilla HTML demonstration application.
