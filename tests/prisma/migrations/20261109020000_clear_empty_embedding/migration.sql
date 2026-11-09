-- A changed source hash becoming null represents empty normalized source.
-- Clear the existing vector while preserving it for ordinary updates.
CREATE OR REPLACE FUNCTION prisma_embedding_sync_test_vector_input()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."embeddingInput" IS NOT NULL THEN
    NEW."embedding" := NEW."embeddingInput"::vector(3);
    NEW."embeddingInput" := NULL;
  ELSIF TG_OP = 'UPDATE'
    AND NEW."embeddingHash" IS DISTINCT FROM OLD."embeddingHash"
    AND NEW."embeddingHash" IS NULL THEN
    NEW."embedding" := NULL;
  END IF;
  RETURN NEW;
END;
$$;
