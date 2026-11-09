CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

CREATE TABLE "Product" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "price" DECIMAL(10, 2) NOT NULL,
  "embedding" vector(768),
  "embeddingHash" TEXT,
  "embeddingInput" TEXT
);

CREATE FUNCTION demo_product_embedding_input()
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
FOR EACH ROW EXECUTE FUNCTION demo_product_embedding_input();
