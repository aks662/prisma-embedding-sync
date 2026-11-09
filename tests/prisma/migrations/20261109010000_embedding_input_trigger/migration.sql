-- Copy Prisma-writable text into the Unsupported pgvector column in the same row mutation.
CREATE FUNCTION prisma_embedding_sync_test_vector_input()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."embeddingInput" IS NOT NULL THEN
    NEW."embedding" := NEW."embeddingInput"::vector(3);
    NEW."embeddingInput" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Product_embedding_input_trigger"
BEFORE INSERT OR UPDATE ON "Product"
FOR EACH ROW EXECUTE FUNCTION prisma_embedding_sync_test_vector_input();
