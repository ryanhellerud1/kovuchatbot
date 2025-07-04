-- First create a temporary function to convert JSON to vector
CREATE OR REPLACE FUNCTION json_to_vector(json_data json) RETURNS vector(1536) AS $$
BEGIN
  IF json_data IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN json_data::text::vector(1536);
END;
$$ LANGUAGE plpgsql;

-- Convert the column type
ALTER TABLE "document_chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1536) USING json_to_vector(embedding);

-- Drop the temporary function
DROP FUNCTION json_to_vector(json);