# prisma-embedding-sync

**Declarative vector-embedding synchronization for Prisma and PostgreSQL.**

> **Development status:** This package is being rebuilt for v0.1.0. It is not yet released or ready for production use. In particular, the integration architecture for writing pgvector `Unsupported` columns through Prisma extensions is under verification. Do not treat the API example below as a working release until the Phase 6 architecture gate is complete and a package version has been published.

<!-- Add npm, CI, and coverage badges only after the package and repository URLs exist. -->

## The problem

An application can store an embedding beside a database row and still return stale semantic-search results. If the text used to create the vector changes but the vector does not, the row and its embedding no longer describe the same content. This is often called a stale or “zombie” vector.

A separate embedding synchronization pipeline introduces another process, queue, or datastore that can fail independently of the primary write. `prisma-embedding-sync` is designed to keep the source fields, their hash, and the corresponding vector coordinated around Prisma write operations instead of requiring a separately managed vector-sync service.

## Intended solution

The v0.1 design exposes a `withEmbeddings(client, config)` helper. You configure a provider and source fields for each Prisma model. The extension normalizes the source fields, computes a SHA-256 hash, and asks the configured provider for an embedding when the normalized source changes. An unchanged source hash should skip the provider call.

The default real provider is Ollama with `nomic-embed-text`. Tests use `MockProvider`; CI must not make real embedding API calls.

**Important implementation constraint:** Prisma does not natively expose pgvector's custom `vector(N)` type as a normal writable field. Prisma represents it as `Unsupported("vector(N)")`, and custom types require raw SQL/custom migrations. Prisma's shared-extension documentation also warns that client-level methods called from a packaged extension can run on a new connection and ignore a caller's active transaction. Therefore the final implementation must pass the transaction-aware pgvector persistence proof before this README can be considered release documentation. The project will not claim that a write is atomic or transaction-safe without an integration test proving it.

## Compatibility target

The initial v0.1 build target is intentionally pinned to Prisma ORM 6 because the original API and generated-client assumptions target Prisma 6.

| Component | v0.1 target |
|---|---|
| Node.js | `^22.12.0 || ^24.0.0` |
| `prisma` CLI (consumer development tool) | `6.19.3` |
| `@prisma/client` | `6.19.3` |
| Database | PostgreSQL 16 |
| Vector extension | pgvector 0.8.7 |
| Embedding model | Ollama `nomic-embed-text` (768 dimensions; verify actual model output) |

Node 26 is Active LTS as of this README review, but Prisma ORM v6's documented supported runtime matrix lists Node 20.19, 22.12, and 24.0 lines. Node 26 is therefore not part of this project's declared Prisma 6 compatibility range.

**Prisma lifecycle warning:** Prisma ORM 6 security maintenance is scheduled to end on 19 November 2026. This is a short-lived compatibility target. A release after that date requires an explicit maintenance/support decision and a plan for a Prisma 7-compatible major/minor line. Prisma ORM 8 is a release candidate in the current Prisma release-status documentation and does not currently include `$extends`; do not assume it is a drop-in upgrade.

## Installation

The package has not yet been published. Once a release is available, install it alongside the Prisma Client version supported by that release:

```bash
npm install prisma-embedding-sync @prisma/client@6.19.3
npm install --save-dev prisma@6.19.3
```

Your application should keep `prisma` and `@prisma/client` aligned. `prisma` is the CLI used to generate/migrate your schema; `@prisma/client` is the runtime peer dependency.

## Quick start (planned v0.1 setup)

The following is the intended consumer setup. **Do not use it as a production recipe until the Phase 6 architecture gate has passed and a release is published.** The SQL/vector column integration is still being verified.

1. Install the released package and Prisma Client, then install the matching Prisma CLI as a development dependency:

   ```bash
   npm install prisma-embedding-sync @prisma/client@6.19.3
   npm install --save-dev prisma@6.19.3
   ```

2. Define a Prisma model. With Prisma 6's `prisma-client-js` generator, a conceptual model is:

   ```prisma
   generator client {
     provider = "prisma-client-js"
   }

   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }

   model Product {
     id            Int      @id @default(autoincrement())
     name          String
     description   String
     price         Decimal  @db.Decimal(10, 2)
     embedding     Unsupported("vector(768)")?
     embeddingHash String?

     @@index([embeddingHash])
   }
   ```

   `embedding` is deliberately an `Unsupported` custom type. It is not a normal Prisma create/update input field. The extension cannot make it writable merely by adding a `number[]` property to `args.data`. The approved Phase 6 implementation must provide the raw-SQL/custom-migration persistence mechanism.

3. Add the extension and vector index in a customized migration. For an existing `Product` table, the SQL portion is:

   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;

   ALTER TABLE "Product"
     ADD COLUMN "embedding" vector(768),
     ADD COLUMN "embeddingHash" text;

   CREATE INDEX "Product_embedding_hnsw_idx"
     ON "Product"
     USING hnsw ("embedding" vector_cosine_ops);
   ```

   The table/column names must match your actual Prisma schema mappings (`@@map` / `@map`). Use the real migration history; do not run the `ALTER TABLE` twice.

4. Create the extended client. This is the planned helper signature from the internal contract:

   ```ts
   import { PrismaClient } from '@prisma/client';
   import { OllamaProvider, withEmbeddings } from 'prisma-embedding-sync';

   const rawPrisma = new PrismaClient();

   export const prisma = withEmbeddings(rawPrisma, {
     models: {
       Product: {
         sourceFields: ['name', 'description'],
         targetField: 'embedding',
         hashField: 'embeddingHash',
         provider: new OllamaProvider(),
         dimensions: 768,
       },
     },
   });
   ```

5. The intended write usage is ordinary Prisma syntax:

   ```ts
   const product = await prisma.product.create({
     data: {
       name: 'Mechanical keyboard',
       description: 'A compact keyboard with tactile switches',
       price: '89.00',
     },
   });
   ```

   After the architecture gate passes, the extension is expected to persist the row, vector, and source hash through the approved write mechanism. The returned object's exact shape must be verified against the final implementation; Prisma does not automatically include an `Unsupported` field in ordinary generated model results.

## PostgreSQL and pgvector setup

A local development database can be started using the project's pinned Docker image once the repository scaffold is created:

```bash
docker compose up -d
docker compose ps
```

Example local environment variable (use a dedicated test database for tests):

```bash
export DATABASE_URL='postgresql://postgres:test@localhost:5432/postgres?schema=public'
```

Do not run destructive test setup against a development or production database.

## Semantic search example (planned)

The package synchronizes embeddings on writes; search itself uses PostgreSQL/pgvector SQL. The example below illustrates cosine-distance search and parameterizes the vector literal. It assumes the approved Phase 6 storage implementation has populated `Product.embedding`.

```ts
const queryText = 'compact tactile keyboard';
const [queryVector] = await new OllamaProvider().embed([queryText]);
const vectorLiteral = `[${queryVector.join(',')}]`;

const results = await prisma.$queryRaw<Array<{
  id: number;
  name: string;
  description: string;
  similarity: number;
}>>`
  SELECT
    id,
    name,
    description,
    1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
  FROM "Product"
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> ${vectorLiteral}::vector
  LIMIT 5
`;
```

If you use a mapped table/column name or another vector dimension, update the SQL and vector configuration accordingly. Do not concatenate untrusted query text or SQL identifiers into a raw SQL string.

## API shape (planned v0.1 contract)

The target public configuration is:

```ts
import { PrismaClient } from '@prisma/client';
import {
  OllamaProvider,
  withEmbeddings,
} from 'prisma-embedding-sync';

const rawPrisma = new PrismaClient();

const prisma = withEmbeddings(rawPrisma, {
  models: {
    Product: {
      sourceFields: ['name', 'description'],
      targetField: 'embedding',
      hashField: 'embeddingHash',
      provider: new OllamaProvider(),
      dimensions: 768,
    },
  },
});
```

This shows the intended two-argument API from the internal contract. It is **not yet a runnable quick-start**: Phase 6 must first establish a supported way to persist a pgvector `Unsupported` column and preserve the documented transaction contract. The final public signature and returned extended-client type must be checked against the generated TypeScript declarations before publication.

### Intended write behavior

When the final implementation is validated:

- `create`: generate/store the embedding and hash before the database write; empty source text stores null values without calling the provider; array payloads are rejected.
- `update`: re-embed only when normalized source content changes; non-source updates should not call the provider.
- `createMany`: batch non-empty source texts and map returned vectors back to original row indexes correctly.
- `upsert`: handle create, dirty-update, and clean-update behavior using a concurrency-safe, approved implementation.
- `updateMany`: throw `UnsupportedOperationError` in v0.1.

Nested relation writes and unsupported Prisma update operators must be rejected unless explicitly implemented and covered by tests.

## How the write path is intended to work

```text
Prisma write request
        |
        v
Resolve configured model and operation
        |
        v
Normalize configured source fields
        |
        v
Compute SHA-256 source hash
        |
        +---- source unchanged (update) ----> skip provider
        |
        v
Call EmbeddingProvider (Ollama or Mock)
        |
        v
Validate result count, dimensions, and finite values
        |
        v
Persist row fields + vector + hash using the approved DB strategy
        |
        v
Return the write result
```

The provider call must finish before the database mutation. A provider error or invalid vector must prevent the mutation. The vector and row data must not be written in separate uncoordinated operations. The final supported transaction behavior will be documented only after Phase 6 integration tests pass.

## Providers

| Provider | Purpose | Network |
|---|---|---|
| `OllamaProvider` | Real local embeddings; default model `nomic-embed-text` | Local Ollama HTTP API |
| `MockProvider` | Deterministic unit/integration tests | None |

The v0.1 provider interface is intended to support future providers, but OpenAI and Gemini implementations are not part of v0.1.

## Cost model

With a local Ollama model, there is no per-request embedding API bill from a hosted provider. You still pay for the machine, electricity, storage, and operational maintenance. Dirty-checking is designed to avoid repeated embedding calls when normalized source content is unchanged; the actual number of avoided calls depends on the application's write pattern. No universal savings percentage is claimed.

## Public API reference (planned)

| Export | Purpose |
|---|---|
| `withEmbeddings(client, config)` | Returns the configured Prisma extended client (final inferred return type must be verified). |
| `OllamaProvider` | Calls the local Ollama embedding endpoint. |
| `MockProvider` | Deterministic provider for tests. |
| `EmbeddingProvider` | Provider interface: `embed(texts): Promise<number[][]>`. |
| `EmbedConfig` | Top-level model configuration and optional logger. |
| `ModelEmbedConfig` | Per-model source fields, vector target, hash target, provider, and dimensions. |
| `OllamaProviderOptions` | Ollama URL, model, timeout, and dimensions options. |
| `MockProviderOptions` | Mock vector dimensions. |
| `sha256(input)` | Lowercase SHA-256 hex digest. |
| `hashSourceFields(data, fields)` | Hashes normalized source-field text in the configured order. |
| `PrismaEmbeddingSyncError` | Base package error. |
| `ConfigValidationError` | Invalid configuration. |
| `DimensionMismatchError` | Provider output dimension does not match config. |
| `UnsupportedOperationError` | Operation is deliberately unsupported. |

The exported declarations and behavior must be tested from the built package before this table is treated as final.

## Development and tests

The project uses a gated phase plan. The internal implementation requirements live in `TASK.md`, which is not shipped to npm.

The selected development toolchain is pinned in `package.json`. Core commands:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
```

The final coverage gate is:

```bash
npm run test:coverage
```

Coverage targets are 85% lines, 85% functions, 80% branches, and 85% statements for `src/`, excluding `src/index.ts`.

Unit tests use `MockProvider`. The Ollama integration test is gated and runs only when explicitly enabled:

```bash
INTEGRATION=1 npx vitest run tests/ollama-provider.test.ts
```

PostgreSQL/pgvector integration tests use a dedicated PostgreSQL 16 database. Never point the test suite at production data.

## Demo

The repository includes a separate Express demo with a vanilla HTML page. It is intended to expose:

- `POST /products`
- `GET /products`
- `PATCH /products/:id`
- `GET /search?q=...`

The search route uses parameterized PostgreSQL raw SQL and pgvector cosine distance. The demo's dependencies are isolated in `demo/package.json`; they are not dependencies of the published library.

A live demo URL will be added after it has been deployed and manually verified. No demo URL is claimed at this stage.

## Limitations in v0.1

- PostgreSQL + pgvector only.
- One inline embedding per configured row; no chunking.
- No OpenAI or Gemini provider.
- No CLI/backfill.
- `updateMany` throws `UnsupportedOperationError`.
- No provider retries, circuit breaker, or rate limiting.
- Nested writes and unsupported update operators are outside the supported contract unless later tests explicitly establish support.
- pgvector custom columns require custom migrations/raw SQL; ordinary Prisma CRUD inputs do not expose `Unsupported` fields as writable scalar fields.
- Transaction composition is not promised until Phase 6 proves the supported behavior. Captured-client raw SQL in an extension can bypass an outer Prisma transaction.
- Prisma 6 compatibility is time-limited by its published support lifecycle; see the compatibility section above.

## Roadmap

- **v0.2:** chunked embeddings, additional provider implementations, and custom splitters (subject to separate API design).
- **v0.3:** CLI/backfill and schema metadata parsing.
- **Future:** safe bulk update support only after a separate transactional design and test suite.

## Contributing

Issues and pull requests are welcome. This is an early v0.1 project; public API and compatibility guarantees are limited until the first stable release.

## License

MIT. See [LICENSE](./LICENSE).

## Technical references

- [Prisma ORM v6 system requirements](https://www.prisma.io/docs/orm/v6/reference/system-requirements)
- [Prisma ORM v6 query extensions](https://www.prisma.io/docs/orm/v6/prisma-client/client-extensions/query)
- [Prisma shared extensions and transaction limitation](https://www.prisma.io/docs/orm/v6/prisma-client/client-extensions/shared-extensions)
- [Prisma ORM v6 generating Prisma Client](https://www.prisma.io/docs/orm/v6/prisma-client/setup-and-configuration/generating-prisma-client)
- [Prisma PostgreSQL extension/custom type guidance](https://www.prisma.io/docs/postgres/database/postgres-extensions)
- [Ollama `/api/embed` documentation](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [pgvector Docker image tags](https://github.com/pgvector/pgvector#docker)
- [Node.js release schedule](https://github.com/nodejs/Release#release-schedule)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
