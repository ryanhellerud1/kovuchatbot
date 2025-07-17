-- Optimized Similarity Search Functions and Views
-- This migration creates optimized functions and materialized views for faster knowledge search

-- 1. Create a materialized view for pre-computed document statistics
DROP MATERIALIZED VIEW IF EXISTS mv_document_stats;
CREATE MATERIALIZED VIEW mv_document_stats AS
SELECT 
    kd.id as document_id,
    kd.user_id,
    kd.title,
    kd.file_type,
    COUNT(dc.id) as chunk_count,
    AVG(length(dc.content)) as avg_chunk_length,
    MIN(dc.created_at) as first_chunk_date,
    MAX(dc.created_at) as last_chunk_date
FROM knowledge_documents kd
LEFT JOIN document_chunks dc ON kd.id = dc.document_id
GROUP BY kd.id, kd.user_id, kd.title, kd.file_type;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_document_stats_document_id 
ON mv_document_stats (document_id);

-- 2. Create an optimized similarity search function
CREATE OR REPLACE FUNCTION search_knowledge_optimized(
    p_user_id UUID,
    p_query_embedding VECTOR(1536),
    p_limit INTEGER DEFAULT 25,
    p_min_similarity FLOAT DEFAULT 0.22
)
RETURNS TABLE (
    id UUID,
    document_id UUID,
    content TEXT,
    chunk_index INTEGER,
    chunk_metadata JSONB,
    document_title TEXT,
    created_at TIMESTAMP,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        dc.id,
        dc.document_id,
        dc.content,
        dc.chunk_index,
        dc.chunk_metadata,
        kd.title as document_title,
        dc.created_at,
        (1 - (dc.embedding <=> p_query_embedding)) as similarity
    FROM document_chunks dc
    INNER JOIN knowledge_documents kd ON dc.document_id = kd.id
    WHERE kd.user_id = p_user_id
        AND dc.embedding IS NOT NULL
        AND (1 - (dc.embedding <=> p_query_embedding)) >= p_min_similarity
    ORDER BY similarity DESC
    LIMIT LEAST(p_limit, 50);
END;
$$ LANGUAGE plpgsql STABLE;

-- 3. Create an index for the similarity search function
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_ivfflat 
ON document_chunks USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

-- 4. Create a function to get adjacent chunks efficiently
CREATE OR REPLACE FUNCTION get_adjacent_chunks_optimized(
    p_user_id UUID,
    p_chunks JSONB
)
RETURNS TABLE (
    id UUID,
    document_id UUID,
    content TEXT,
    chunk_index INTEGER,
    chunk_metadata JSONB,
    document_title TEXT,
    created_at TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        dc.id,
        dc.document_id,
        dc.content,
        dc.chunk_index,
        dc.chunk_metadata,
        kd.title as document_title,
        dc.created_at
    FROM document_chunks dc
    INNER JOIN knowledge_documents kd ON dc.document_id = kd.id
    WHERE kd.user_id = p_user_id
        AND EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(p_chunks) AS chunk
            WHERE (chunk->>'documentId')::UUID = dc.document_id
                AND (chunk->>'chunkIndex')::INTEGER IN (
                    (chunk->>'chunkIndex')::INTEGER - 1,
                    (chunk->>'chunkIndex')::INTEGER + 1
                )
        )
    ORDER BY dc.document_id, dc.chunk_index;
END;
$$ LANGUAGE plpgsql STABLE;

-- 5. Create a composite index for adjacent chunk lookups
CREATE INDEX IF NOT EXISTS idx_document_chunks_adjacent 
ON document_chunks (document_id, chunk_index) 
INCLUDE (content, chunk_metadata);

-- 6. Create a function for fast document existence check
CREATE OR REPLACE FUNCTION check_user_documents(
    p_user_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    doc_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO doc_count
    FROM knowledge_documents
    WHERE user_id = p_user_id;
    
    RETURN doc_count > 0;
END;
$$ LANGUAGE plpgsql STABLE;

-- 7. Create a partial index for active documents
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_active 
ON knowledge_documents (user_id, created_at DESC) 
WHERE file_url IS NOT NULL;

-- 8. Create a statistics table for query optimization
CREATE TABLE IF NOT EXISTS search_performance_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    query_hash VARCHAR(64),
    execution_time_ms INTEGER,
    result_count INTEGER,
    similarity_threshold FLOAT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 9. Create an index for performance tracking
CREATE INDEX IF NOT EXISTS idx_search_performance_user_time 
ON search_performance_stats (user_id, created_at DESC);

-- 10. Create a function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_document_stats()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_document_stats;
END;
$$ LANGUAGE plpgsql;

-- 11. Create a trigger to auto-refresh stats on document changes
CREATE OR REPLACE FUNCTION trigger_refresh_document_stats()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM refresh_document_stats();
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 12. Create triggers for automatic stats refresh
DROP TRIGGER IF EXISTS trg_refresh_doc_stats ON knowledge_documents;
CREATE TRIGGER trg_refresh_doc_stats
    AFTER INSERT OR UPDATE OR DELETE ON knowledge_documents
    EXECUTE FUNCTION trigger_refresh_document_stats();

-- 13. Create a function for batch chunk retrieval
CREATE OR REPLACE FUNCTION get_chunks_batch(
    p_chunk_ids UUID[]
)
RETURNS TABLE (
    id UUID,
    document_id UUID,
    content TEXT,
    chunk_index INTEGER,
    chunk_metadata JSONB,
    document_title TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        dc.id,
        dc.document_id,
        dc.content,
        dc.chunk_index,
        dc.chunk_metadata,
        kd.title as document_title
    FROM document_chunks dc
    INNER JOIN knowledge_documents kd ON dc.document_id = kd.id
    WHERE dc.id = ANY(p_chunk_ids)
    ORDER BY dc.document_id, dc.chunk_index;
END;
$$ LANGUAGE plpgsql STABLE;

-- 14. Create an index for batch lookups
CREATE INDEX IF NOT EXISTS idx_document_chunks_id_lookup 
ON document_chunks (id) 
INCLUDE (document_id, content, chunk_index, chunk_metadata);

-- 15. Update table statistics
ANALYZE document_chunks;
ANALYZE knowledge_documents;
