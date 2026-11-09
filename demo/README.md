# Local demo

This isolated Express app demonstrates product creation, listing, editing, and semantic search with PostgreSQL and pgvector. It has a separate demo database on port 5433; it does not share the package integration-test database.

## Requirements

- Node.js 22.12+ or 24.x (Prisma 6 does not declare Node 26 support).
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

- `DATABASE_URL` is checked at startup and must identify the local `prisma_embedding_sync_demo` database.
- Editing a description sends the complete current source fields with the stored hash compare-and-swap token. A price-only edit sends no source fields and leaves provider/vector/hash state unchanged.
- Do not point this local demo at personal or production data.
