# prisma-embedding-sync

**Keep Prisma row text and its PostgreSQL pgvector embedding in sync.**

## Badges

No npm, repository, or coverage badges are shown because this README does not yet have verified public badge URLs.

## The problem

When text stored on a row changes but its embedding does not, semantic search uses a vector for stale content. Keeping rows and vectors synchronized through a separate queue or service adds another write path to operate and recover.

## The solution

`prisma-embedding-sync` provides embedding-aware `create`, `createMany`, `update`, `upsert`, and guarded `updateMany` hooks for Prisma Client. Configure the source fields for each model and a provider. The extension normalizes and hashes those fields, skips unnecessary provider calls when the source is unchanged, and stages vectors for PostgreSQL to persist through a trigger.

```ts
const raw = new PrismaClient();
const prisma = raw.$extends(withEmbeddings({
  models: {
    Product: {
      sourceFields: ['name', 'description'],
      targetField: 'embedding',
      hashField: 'embeddingHash',
      provider: new OllamaProvider(),
      dimensions: 768,
    },
  },
}));
```

## Quick start

Prisma 6.19.3 and Prisma 7.10.1 have both been verified against PostgreSQL/pgvector under Node.js 24.22.2. The package declares peer support for `@prisma/client` `^6.19.3 || ^7.10.1` and Node.js `^22.12.0 || ^24.0.0`; CI is configured to exercise both Node lines. Match the Prisma CLI and client major versions. Prisma 7 direct PostgreSQL clients also need the PostgreSQL driver adapter:

```bash
npm install prisma-embedding-sync@0.1.0 @prisma/client@6.19.3
npm install --save-dev prisma@6.19.3
```

For Prisma 7:

```bash
npm install prisma-embedding-sync@0.1.0 @prisma/client@7.10.1 @prisma/adapter-pg@7.10.1
npm install --save-dev prisma@7.10.1
```

Version 0.1.0 is not published yet; these package install commands apply after an approved publication.

### 1. Define the Prisma model

Use a nullable `Unsupported("vector(768)")` field for the vector and a writable string staging field. The package derives the staging field name from `targetField` plus `Input`. For Prisma 6.19, use its `prisma-client-js` generator and datasource URL:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Product {
  id             Int      @id @default(autoincrement())
  name           String
  description    String
  price          Decimal  @db.Decimal(10, 2)
  embedding      Unsupported("vector(768)")?
  embeddingHash  String?
  embeddingInput String?
}
```

For Prisma 7, use the new generator with an explicit output path and keep the datasource URL in `prisma.config.ts`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}

model Product {
  id             Int      @id @default(autoincrement())
  name           String
  description    String
  price          Decimal  @db.Decimal(10, 2)
  embedding      Unsupported("vector(768)")?
  embeddingHash  String?
  embeddingInput String?
}
```

```ts
// prisma.config.ts
import { existsSync } from 'node:fs';
import process from 'node:process';
import { defineConfig } from 'prisma/config';

if (existsSync('.env')) process.loadEnvFile('.env');
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error('DATABASE_URL is required');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: databaseUrl },
});
```

### 2. Add pgvector and the trigger migration

Create an unapplied migration from the schema. `--create-only` leaves it unapplied so you can add the required custom SQL before Prisma records it as applied:

```bash
npx prisma migrate dev --name init --create-only
```

The Prisma-generated `CREATE TABLE` includes all fields in the schema, including the `Unsupported` vector and the hash/staging columns. Add the extension statement at the very beginning of `migration.sql`, before the generated table statement:

```sql
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
```

Then append the trigger function and trigger after the generated `CREATE TABLE` statement:

```sql
CREATE FUNCTION product_embedding_input()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."embeddingInput" IS NOT NULL THEN
    NEW."embedding" := NEW."embeddingInput"::vector(768);
    NEW."embeddingInput" := NULL;
  ELSIF TG_OP = 'UPDATE'
    AND NEW."embeddingHash" IS DISTINCT FROM OLD."embeddingHash"
    AND NEW."embeddingHash" IS NULL THEN
    NEW."embedding" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Product_embedding_input_trigger"
BEFORE INSERT OR UPDATE ON "Product"
FOR EACH ROW EXECUTE FUNCTION product_embedding_input();
```

Use the vector dimension and table/column mappings from your own schema. The trigger must write the vector and clear the staging field in the same row mutation.

After editing the migration, apply it and generate the client. Prisma 6 uses the schema URL; Prisma 7 reads the URL through `prisma.config.ts`:

```bash
npx prisma migrate dev
npx prisma generate
```

```bash
# Prisma 7
npx prisma migrate dev --config prisma.config.ts
npx prisma generate --config prisma.config.ts
```

### 3. Create the extended client

```ts
import { PrismaClient } from '@prisma/client';
import { OllamaProvider, withEmbeddings } from 'prisma-embedding-sync';

const raw = new PrismaClient();
const prisma = raw.$extends(withEmbeddings({
  models: {
    Product: {
      sourceFields: ['name', 'description'],
      targetField: 'embedding',
      hashField: 'embeddingHash',
      provider: new OllamaProvider(),
      dimensions: 768,
    },
  },
}));
```

For Prisma 7, import the client from the configured generated output and initialize it with the PostgreSQL adapter:

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { OllamaProvider, withEmbeddings } from 'prisma-embedding-sync';

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error('DATABASE_URL is required');

const raw = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});
const prisma = raw.$extends(
  withEmbeddings({
    models: {
      Product: {
        sourceFields: ['name', 'description'],
        targetField: 'embedding',
        hashField: 'embeddingHash',
        provider: new OllamaProvider(),
        dimensions: 768,
      },
    },
  }),
);
```

`withEmbeddings(config)` returns a version-neutral query-extension definition. Applying it through the consuming client’s `$extends` method keeps the model and delegate types from that client’s generated Prisma schema.

### 4. Write with Prisma as usual

```ts
const product = await prisma.product.create({
  data: {
    name: 'Mechanical keyboard',
    description: 'A compact keyboard with tactile switches',
    price: '89.00',
  },
});
```

The extension adds the embedding hash and staging value. The database trigger transfers the vector into `embedding` before the row mutation completes and clears `embeddingInput`. The `Unsupported` vector field is not returned by ordinary Prisma model queries.

## Architecture and write path

```text
Prisma create / createMany / update / upsert
                    |
                    v
       Normalize configured source fields
                    |
                    v
        Hash source and check for changes
                    |
                    v
       Call provider and validate vectors
                    |
                    v
 Prisma query writes row + hash + staging text
                    |
                    v
 PostgreSQL trigger casts text to vector(N),
             then clears staging text
```

Provider work finishes **before** the database mutation; it is never part of a PostgreSQL transaction. The trigger persists the vector and ordinary row fields in the same database mutation. PostgreSQL integration tests cover the implemented operations and transaction rollback paths on the project's tested PostgreSQL/pgvector stack. These results do not imply that the external provider call rolls back with the database.

For `update`, source changes require all configured source fields and the current hash in `where`. The hash is an optimistic concurrency guard: if another write changes the source first, the update matches no row. Reload the row and retry with its new hash. Prisma extension transaction behavior is operation-specific; use the caller's transaction APIs and do not assume provider calls are transactional.

## Providers

| Export | Use | Network behavior |
|---|---|---|
| `OllamaProvider` | Real embeddings from a local Ollama server; defaults to `nomic-embed-text` at 768 dimensions | Calls local Ollama `/api/embed` using `fetch` |
| `MockProvider` | Deterministic vectors for tests and examples | No network calls; not a semantic embedding model |

OpenAI, Gemini, and other hosted embedding providers are not implemented in version 0.1. The configured model's actual dimensions must match the Prisma vector column and `ModelEmbedConfig.dimensions`.

## API reference

The package entry point exports the following runtime symbols and types. `withEmbeddings` returns a version-neutral `EmbeddingExtension`; call the consuming Prisma client’s `$extends` method to obtain the extended client with its generated model and delegate types.

| Export | Declaration / signature |
|---|---|
| `withEmbeddings` | `withEmbeddings(config: EmbedConfig): EmbeddingExtension` |
| `sha256` | `sha256(input: string): string` |
| `hashSourceFields` | `hashSourceFields(data: Record<string, unknown>, sourceFields: string[]): string` |
| `MockProvider` | `new MockProvider(options?: MockProviderOptions)`; implements `EmbeddingProvider` |
| `OllamaProvider` | `new OllamaProvider(options?: OllamaProviderOptions)`; implements `EmbeddingProvider` |
| `EmbeddingProvider` | `{ embed(texts: string[]): Promise<number[][]>; readonly dimensions: number; readonly modelName: string }` |
| `EmbedConfig` | `{ models: Record<string, ModelEmbedConfig>; logger?: (message: string, meta?: Record<string, unknown>) => void }` |
| `EmbeddingExtension` | The exact hook interface below; consumed by the generated client’s `$extends` method |
| `EmbeddingQueryContext<TArgs, TResult>` | `{ model?: string; args: TArgs; query: (args: TArgs) => PromiseLike<TResult> }` |
| `ModelEmbedConfig` | `{ sourceFields: string[]; targetField: string; hashField?: string; provider: EmbeddingProvider; dimensions: number }` |
| `OllamaProviderOptions` | `{ baseUrl?: string; model?: string; timeoutMs?: number; dimensions?: number }` |
| `MockProviderOptions` | `{ dimensions?: number }` |
| `PrismaEmbeddingSyncError` | `new PrismaEmbeddingSyncError(message: string, code: string)` |
| `ConfigValidationError` | `new ConfigValidationError(message: string)` |
| `DimensionMismatchError` | `new DimensionMismatchError(message: string)` |
| `UnsupportedOperationError` | `new UnsupportedOperationError(message: string)` |

The Prisma-version-neutral extension contract is:

```ts
interface EmbeddingQueryContext<TArgs, TResult> {
  model?: string;
  args: TArgs;
  query: (args: TArgs) => PromiseLike<TResult>;
}

interface EmbeddingExtension {
  readonly name: 'prisma-embedding-sync';
  readonly query: {
    readonly $allModels: {
      create<TArgs extends { data: unknown }, TResult>(
        context: EmbeddingQueryContext<TArgs, TResult>,
      ): Promise<TResult>;
      update<TArgs extends { where: unknown; data: unknown }, TResult>(
        context: EmbeddingQueryContext<TArgs, TResult>,
      ): Promise<TResult>;
      createMany<TArgs extends { data: unknown }, TResult>(
        context: EmbeddingQueryContext<TArgs, TResult>,
      ): Promise<TResult>;
      upsert<TArgs extends { where: unknown; create: unknown; update: unknown }, TResult>(
        context: EmbeddingQueryContext<TArgs, TResult>,
      ): Promise<TResult>;
      updateMany<TArgs, TResult>(
        context: EmbeddingQueryContext<TArgs, TResult>,
      ): Promise<never>;
    };
  };
}
```

`create`, `createMany`, `update`, and `upsert` are Prisma Client operations intercepted by the extension, not separate package exports. No search API is exported; applications issue parameterized SQL through Prisma for pgvector search.

## Limitations and compatibility

- **Database:** PostgreSQL with the pgvector extension. The vector column and trigger require a custom SQL migration.
- **Embeddings:** One inline vector per row. There is no chunking or chunk store.
- **Backfill:** No CLI or built-in backfill command. Existing rows need application-owned backfill logic.
- **Bulk updates:** `updateMany` throws `UnsupportedOperationError` before provider or database work. Use individual `update` calls.
- **Retries:** No provider retries, rate limiter, or circuit breaker.
- **Write shapes:** Managed vector/hash/staging fields, nested writes, JSON/array update values, and unsupported Prisma update operators are rejected for configured writes. Source updates require complete source fields and the current hash in `where`.
- **Transactions:** Provider calls happen outside database transactions. The vector, hash, staging value, and row fields are persisted through the same mutation and trigger. Transaction behavior is bounded by the tested Prisma operations and PostgreSQL/pgvector versions; do not infer broader guarantees.
- **Prisma:** Prisma CLI and `@prisma/client` 6.19.3 and 7.10.1 are verified targets (local PostgreSQL/pgvector matrix on Node 24.22.2). The peer range is `^6.19.3 || ^7.10.1`; other versions are not yet verified. Prisma 7 requires its generated `prisma-client` output path, a datasource URL in `prisma.config.ts`, and a PostgreSQL driver adapter for direct connections. The package itself does not create the Prisma client or require an adapter dependency.
- **Prisma 6 CLI security note (checked 10 November 2026):** Prisma CLI 6.19.3 resolves `@prisma/config@6.19.3`, which pins vulnerable `deepmerge-ts@7.1.5`. The upstream advisory [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) affects versions before 8.0.0 when merging two matching recursive object graphs. Prisma's config loader passes the plain `deepmerge` function to c12 for merging the developer-authored Prisma config. Prisma's merged Prisma 7 dependency update uses `deepmerge-ts@8.0.2` at that call site; the Prisma 6 line still pins 7.1.5. This package's development dependency tree pins `deepmerge-ts@8.0.2` with npm `overrides`; Prisma 6.19.3 generation, config validation, migration deployment, and PostgreSQL integration tests pass with that resolution under Node 22 and 24. The published library has no runtime dependencies and does not include Prisma CLI or `deepmerge-ts`.

  Applications that separately install Prisma CLI 6.19.3 can apply the same tested npm override in their **application's root** `package.json`:

  ```json
  {
    "overrides": {
      "deepmerge-ts": "8.0.2"
    }
  }
  ```

  This intentionally replaces Prisma's exact transitive 7.1.5 pin and should be retained only while the application's Prisma 6 config, generation, and migration commands pass. An override in this library's package manifest does not change a consumer application's dependency tree. The advisory requires a recursive object graph; Prisma's config file is executable developer-authored code, so do not load untrusted Prisma config files. Prisma 7.10.1's verified dependency tree already uses the patched major and reports no finding for this advisory.
- **Node.js:** `^22.12.0 || ^24.0.0`, as declared in `package.json`. Node 26 is outside this package's declared range.
- **Prisma 6 lifecycle:** Prisma 6 receives security patches until 19 November 2026. Support after that date requires a security-maintenance review; compatibility tests alone do not extend Prisma's maintenance window.

## Roadmap

Possible later work, subject to separate design and approval:

- **0.2:** Chunked embeddings and additional provider implementations.
- **0.3:** Backfill tooling and schema metadata parsing.
- **Future:** Bulk update support only if a safe per-row concurrency design is established.

These are plans, not version 0.1 capabilities or release commitments.

## Demo

There is no hosted demo URL yet. To run the local Express and vanilla HTML demo from a checkout:

```bash
cd demo
cp .env.example .env
npm ci
docker compose up -d
npm run db:generate
npm run db:migrate
ollama pull nomic-embed-text
npm run dev
```

The demo uses Prisma 7. Its generated client is written to `demo/generated/prisma`, its database URL is read through `demo/prisma.config.ts`, and it connects through `@prisma/adapter-pg`. The extension is applied as `client.$extends(withEmbeddings(config))` so Prisma’s generated model types are retained.

Open [http://localhost:3001](http://localhost:3001). The demo database is isolated on host port `5433`; it does not use the package integration-test database on port `5432`. The default server uses Ollama. The demo API smoke script injects `MockProvider` and does not require Ollama:

```bash
npm run test:smoke
```

The demo provides `POST /products`, `GET /products`, `PATCH /products/:id`, and `GET /search?q=...`. Product JSON omits vector values. Search uses parameterized `$queryRaw` and pgvector cosine distance.

## Contributing

Issues and pull requests are welcome. Please include focused tests for behavior changes and run the project checks before proposing a change. Public API and compatibility changes require review. The demo is an isolated application under `demo/`.

## License

MIT. See [LICENSE](./LICENSE).
