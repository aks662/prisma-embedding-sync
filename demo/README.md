# Local demo

This isolated Express app demonstrates product creation, listing, editing, and semantic search with PostgreSQL and pgvector. It has a separate demo database on port 5433; it does not share the package integration-test database.

## Requirements

- Node.js 22.12+ or 24.x.
- Prisma 7.10.1 with the PostgreSQL driver adapter (the demo pins both).
- Docker Compose.
- Ollama with `nomic-embed-text` pulled and running locally.

## Run

```bash
cp .env.example .env
npm ci
docker compose up -d
npm run db:generate
npm run db:migrate
ollama pull nomic-embed-text
npm run dev
```

Open [http://localhost:3001](http://localhost:3001). The API supports `POST /products`, `GET /products`, `PATCH /products/:id`, and `GET /search?q=...`. Product JSON omits vectors. Search uses a parameterized raw query ordered by pgvector cosine distance.

The API smoke check uses the isolated demo database and an injected deterministic `MockProvider`, so it does not need Ollama:

```bash
npm run test:smoke
```

## Notes

- `DATABASE_URL` is checked at startup and must identify `prisma_embedding_sync_demo` on loopback port `5433`, using the `public` schema. The Compose container listens on port `5432` internally and is bound to host loopback only.
- Prisma 7 generates the client into `generated/prisma`, reads the datasource URL from `prisma.config.ts`, and connects through `@prisma/adapter-pg`.
- Editing a description sends the complete current source fields with the stored hash compare-and-swap token. A price-only edit sends no source fields and leaves provider/vector/hash state unchanged.
- The local server limits API traffic per connecting IP: 120 API requests per minute overall, 10 create/update requests per 15 minutes, and 20 searches per minute. Excess requests receive HTTP 429 and `Retry-After`. These in-memory limits are best-effort for one local process; they reset on restart and are not a substitute for an edge limiter or authentication on a hosted, multi-instance service.
- The API has no authentication. It binds to `127.0.0.1` and must remain private until an access gate and abuse controls are selected for any hosted preview. Do not expose the writable API publicly.
- The server refuses to start when `NODE_ENV=production`; it is not a production deployment target and its default embedding provider is local Ollama.
- Product listing returns at most 100 rows and does not currently support pagination. Database migrations are an explicit setup/deployment step; the server does not run them at startup.
- Compose uses the local `postgres` role and a placeholder password for development only. A hosted database needs a separate least-privilege role and an explicit backup/restore plan; the local Docker volume is persistence, not a backup.
- The page uses inline CSS and JavaScript. Its CSP therefore permits inline scripts and styles while restricting other resource origins; move these assets or use hashes/nonces before relying on a strict CSP.
- Do not point this local demo at personal or production data.
