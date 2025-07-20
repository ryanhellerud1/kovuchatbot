-- Targeted Query Optimization Helper
-- This migration adds a helper function to refresh optimization data for a single document.

CREATE OR REPLACE FUNCTION refresh_optimization_data_for_document(p_document_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Update statistics for the tables related to the specific document.
    -- Note: ANALYZE on modern PostgreSQL can be quite efficient and might not be strictly limited to the rows,
    -- but this is the most direct way to signal that statistics related to recent changes should be updated.
    ANALYZE document_chunks;
    ANALYZE knowledge_documents;

    -- It's not possible to partially refresh a materialized view.
    -- If mv_document_stats exists and needs to be updated, a full refresh is still required.
    -- For now, we will rely on ANALYZE to improve planning for the newly added data.
    -- A full, scheduled refresh of the materialized view remains the best practice.

    RAISE NOTICE 'Refreshed statistics for tables containing document %', p_document_id;
END;
$$ LANGUAGE plpgsql;
