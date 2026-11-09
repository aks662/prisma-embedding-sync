-- Dedicated PostgreSQL test schema. Extension and fixture table are isolated to the test database.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "Product" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "price" DECIMAL(10, 2) NOT NULL,
  "embedding" vector(3),
  "embeddingHash" TEXT,
  "embeddingInput" TEXT
);
