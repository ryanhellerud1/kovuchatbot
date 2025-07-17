-- Query Optimization Helpers and Performance Monitoring
-- This migration adds helper functions and monitoring for query performance

-- 1. Create a function to analyze query performance
CREATE OR REPLACE FUNCTION analyze_knowledge_search_performance(
    p_user_id UUID,
    p_query TEXT,
    p_query_embedding VECTOR(1536),
    p_limit INTEGER DEFAULT 25,
    p_min_similarity FLOAT DEFAULT 0.22
)
RETURNS TABLE (
    execution_time_ms INTEGER,
    result_count INTEGER,
    query_plan JSONB,
    index_usage JSONB
) AS $$
DECLARE
    start_time TIMESTAMP;
    end_time TIMESTAMP;
    plan_result JSONB;
    explain_query TEXT;
BEGIN
    start_time := clock_timestamp();
    
    -- Execute the search and get results
    PERFORM * 
    FROM search_knowledge_optimized(p_user_id, p_query_embedding, p_limit, p_min_similarity);
    
    end_time := clock_timestamp();
    
    -- Get query plan
    explain_query := format(
        'EXPLAIN (FORMAT JSON) SELECT * FROM search_knowledge_optimized(%L, %L, %s, %s)',
        p_user_id, p_query_embedding, p_limit, p_min_similarity
    );
    
    EXECUTE explain_query INTO plan_result;
    
    -- Return performance metrics
    RETURN QUERY
    SELECT 
        EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER,
        (SELECT COUNT(*) FROM search_knowledge_optimized(p_user_id, p_query_embedding, p_limit, p_min_similarity)),
        plan_result,
        jsonb_build_object(
            'indexes_used', (
                SELECT jsonb_agg(jsonb_build_object(
                    'index_name', indexrelid::regclass,
                    'table_name', indrelid::regclass,
                    'index_type', am.amname
                ))
                FROM pg_index i
                JOIN pg_class c ON c.oid = i.indrelid
                JOIN pg_class ic ON ic.oid = i.indexrelid
                JOIN pg_am am ON am.oid = ic.relam
                WHERE c.relname IN ('document_chunks', 'knowledge_documents')
            )
        );
END;
$$ LANGUAGE plpgsql;

-- 2. Create a function to get database size information
CREATE OR REPLACE FUNCTION get_knowledge_base_size(p_user_id UUID)
RETURNS TABLE (
    total_documents BIGINT,
    total_chunks BIGINT,
    total_size_bytes BIGINT,
    avg_chunk_size_bytes BIGINT,
    embedding_storage_bytes BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(DISTINCT kd.id)::BIGINT as total_documents,
        COUNT(dc.id)::BIGINT as total_chunks,
        SUM(length(dc.content))::BIGINT as total_size_bytes,
        AVG(length(dc.content))::BIGINT as avg_chunk_size_bytes,
        (COUNT(dc.id) * 1536 * 4)::BIGINT as embedding_storage_bytes
    FROM knowledge_documents kd
    LEFT JOIN document_chunks dc ON kd.id = dc.document_id
    WHERE kd.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- 3. Create a function to optimize vector search parameters
CREATE OR REPLACE FUNCTION optimize_vector_search_params(
    p_user_id UUID,
    p_target_recall FLOAT DEFAULT 0.9
)
RETURNS TABLE (
    optimal_probes INTEGER,
    optimal_lists INTEGER,
    estimated_recall FLOAT,
    estimated_time_ms FLOAT
) AS $$
DECLARE
    total_vectors INTEGER;
    optimal_lists_calc INTEGER;
    optimal_probes_calc INTEGER;
BEGIN
    -- Get total number of vectors for this user
    SELECT COUNT(*) INTO total_vectors
    FROM document_chunks dc
    JOIN knowledge_documents kd ON dc.document_id = kd.id
    WHERE kd.user_id = p_user_id AND dc.embedding IS NOT NULL;
    
    -- Calculate optimal parameters based on vector count
    optimal_lists_calc := GREATEST(10, LEAST(1000, total_vectors / 1000));
    optimal_probes_calc := GREATEST(1, LEAST(100, CEIL(optimal_lists_calc * (1 - p_target_recall) * 2)));
    
    RETURN QUERY
    SELECT 
        optimal_probes_calc as optimal_probes,
        optimal_lists_calc as optimal_lists,
        p_target_recall as estimated_recall,
        (total_vectors * 0.1 * optimal_probes_calc / optimal_lists_calc) as estimated_time_ms;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4. Create a function to clean up orphaned chunks
CREATE OR REPLACE FUNCTION cleanup_orphaned_chunks()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM document_chunks dc
    WHERE NOT EXISTS (
        SELECT 1 
        FROM knowledge_documents kd 
        WHERE kd.id = dc.document_id
    );
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Update statistics after cleanup
    ANALYZE document_chunks;
    ANALYZE knowledge_documents;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 5. Create a function to rebuild vector indexes
CREATE OR REPLACE FUNCTION rebuild_vector_indexes()
RETURNS VOID AS $$
BEGIN
    -- Drop existing indexes
    DROP INDEX IF EXISTS idx_document_chunks_embedding_ivfflat;
    
    -- Rebuild with optimal parameters
    CREATE INDEX CONCURRENTLY idx_document_chunks_embedding_ivfflat 
    ON document_chunks USING ivfflat (embedding vector_cosine_ops) 
    WITH (lists = 100);
    
    -- Update statistics
    ANALYZE document_chunks;
END;
$$ LANGUAGE plpgsql;

-- 6. Create a table for query cache
CREATE TABLE IF NOT EXISTS knowledge_query_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    query_hash VARCHAR(64) NOT NULL,
    query_embedding VECTOR(1536) NOT NULL,
    results JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '1 hour',
    hit_count INTEGER DEFAULT 1
);

-- 7. Create indexes for query cache
CREATE INDEX IF NOT EXISTS idx_knowledge_query_cache_user_hash 
ON knowledge_query_cache (user_id, query_hash);

CREATE INDEX IF NOT EXISTS idx_knowledge_query_cache_expires 
ON knowledge_query_cache (expires_at);

-- 8. Create a function to manage query cache
CREATE OR REPLACE FUNCTION cache_knowledge_search(
    p_user_id UUID,
    p_query_hash VARCHAR(64),
    p_query_embedding VECTOR(1536),
    p_results JSONB
)
RETURNS VOID AS $$
BEGIN
    -- Insert or update cache entry
    INSERT INTO knowledge_query_cache (user_id, query_hash, query_embedding, results)
    VALUES (p_user_id, p_query_hash, p_query_embedding, p_results)
    ON CONFLICT (user_id, query_hash) 
    DO UPDATE SET 
        results = EXCLUDED.results,
        created_at = NOW(),
        expires_at = NOW() + INTERVAL '1 hour',
        hit_count = knowledge_query_cache.hit_count + 1;
END;
$$ LANGUAGE plpgsql;

-- 9. Create a function to get cached results
CREATE OR REPLACE FUNCTION get_cached_knowledge_search(
    p_user_id UUID,
    p_query_hash VARCHAR(64)
)
RETURNS TABLE (
    results JSONB,
    is_expired BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        results,
        expires_at < NOW() as is_expired
    FROM knowledge_query_cache
    WHERE user_id = p_user_id 
        AND query_hash = p_query_hash
        AND expires_at > NOW();
END;
$$ LANGUAGE plpgsql STABLE;

-- 10. Create a function to clean expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM knowledge_query_cache
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 11. Create a function to get search performance summary
CREATE OR REPLACE FUNCTION get_search_performance_summary(
    p_user_id UUID,
    p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
    avg_execution_time_ms FLOAT,
    total_queries INTEGER,
    cache_hit_rate FLOAT,
    avg_result_count FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        AVG(execution_time_ms)::FLOAT as avg_execution_time_ms,
        COUNT(*)::INTEGER as total_queries,
        CASE 
            WHEN COUNT(*) > 0 THEN 
                (COUNT(*) FILTER (WHERE query_hash IN (
                    SELECT query_hash 
                    FROM knowledge_query_cache 
                    WHERE user_id = p_user_id
                ))::FLOAT / COUNT(*)) * 100
            ELSE 0
        END as cache_hit_rate,
        AVG(result_count)::FLOAT as avg_result_count
    FROM search_performance_stats
    WHERE user_id = p_user_id
        AND created_at > NOW() - INTERVAL '1 day' * p_days;
END;
$$ LANGUAGE plpgsql STABLE;

-- 12. Create a function to optimize database settings
CREATE OR REPLACE FUNCTION optimize_database_settings()
RETURNS TABLE (
    setting_name TEXT,
    current_value TEXT,
    recommended_value TEXT,
    description TEXT
) AS $$
BEGIN
    RETURN QUERY
    VALUES 
        ('shared_buffers', current_setting('shared_buffers'), '256MB', 'Memory for shared buffers'),
        ('work_mem', current_setting('work_mem'), '64MB', 'Memory for sorting and hashing'),
        ('maintenance_work_mem', current_setting('maintenance_work_mem'), '256MB', 'Memory for maintenance operations'),
        ('effective_cache_size', current_setting('effective_cache_size'), '1GB', 'Effective cache size for planner'),
        ('random_page_cost', current_setting('random_page_cost'), '1.1', 'Cost of random page access'),
        ('seq_page_cost', current_setting('seq_page_cost'), '1.0', 'Cost of sequential page access'),
        ('max_parallel_workers_per_gather', current_setting('max_parallel_workers_per_gather'), '4', 'Max parallel workers per gather');
END;
$$ LANGUAGE plpgsql STABLE;

-- 13. Create a function to get index usage statistics
CREATE OR REPLACE FUNCTION get_index_usage_stats()
RETURNS TABLE (
    index_name TEXT,
    table_name TEXT,
    index_size_bytes BIGINT,
    index_scans BIGINT,
    index_tuples_read BIGINT,
    index_tuples_fetched BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        i.relname as index_name,
        t.relname as table_name,
        pg_relation_size(i.oid) as index_size_bytes,
        s.idx_scan as index_scans,
        s.idx_tup_read as index_tuples_read,
        s.idx_tup_fetch as index_tuples_fetched
    FROM pg_class i
    JOIN pg_index ix ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    LEFT JOIN pg_stat_user_indexes s ON i.oid = s.indexrelid
    WHERE t.relname IN ('document_chunks', 'knowledge_documents', 'knowledge_query_cache')
    ORDER BY s.idx_scan DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql STABLE;

-- 14. Create a function to refresh all optimization data
CREATE OR REPLACE FUNCTION refresh_optimization_data()
RETURNS VOID AS $$
BEGIN
    -- Refresh materialized view
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_document_stats;
    
    -- Update statistics
    ANALYZE document_chunks;
    ANALYZE knowledge_documents;
    ANALYZE knowledge_query_cache;
    
    -- Clean expired cache
    PERFORM cleanup_expired_cache();
    
    -- Clean orphaned chunks
    PERFORM cleanup_orphaned_chunks();
END;
$$ LANGUAGE plpgsql;

-- 15. Create a scheduled job to run optimization tasks
CREATE OR REPLACE FUNCTION run_scheduled_optimization()
RETURNS VOID AS $$
BEGIN
    -- Run optimization tasks
    PERFORM refresh_optimization_data();
    
    -- Log completion
    RAISE NOTICE 'Scheduled optimization completed at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- 16. Create a trigger to update search performance stats
CREATE OR REPLACE FUNCTION log_search_performance()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search_performance_stats (user_id, query_hash, execution_time_ms, result_count, similarity_threshold)
    VALUES (NEW.user_id, md5(NEW.query_embedding::TEXT), 0, 0, 0.22);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 17. Create the search performance stats table if it doesn't exist
CREATE TABLE IF NOT EXISTS search_performance_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    query_hash VARCHAR(64),
    execution_time_ms INTEGER,
    result_count INTEGER,
    similarity_threshold FLOAT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 18. Create indexes for performance stats
CREATE INDEX IF NOT EXISTS idx_search_performance_user_time 
ON search_performance_stats (user_id, created_at DESC);

-- 19. Update all table statistics
ANALYZE document_chunks;
ANALYZE knowledge_documents;
ANALYZE knowledge_query_cache;
ANALYZE search_performance_stats;
