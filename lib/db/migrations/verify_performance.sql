-- Performance Verification Script
-- This script verifies that all performance optimizations are working correctly

-- 1. Check if all required extensions are installed
SELECT 
    'pgvector extension' as extension_name,
    CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') 
         THEN '✓ Installed' 
         ELSE '✗ Missing' 
    END as status;

-- 2. Check if all key tables exist
SELECT 
    table_name,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t.table_name) 
         THEN '✓ Exists' 
         ELSE '✗ Missing' 
    END as status
FROM (VALUES 
    ('knowledge_documents'),
    ('document_chunks'),
    ('knowledge_query_cache'),
    ('search_performance_stats')
) AS t(table_name);

-- 3. Check if all key indexes exist
SELECT 
    index_name,
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = i.index_name) 
         THEN '✓ Exists' 
         ELSE '✗ Missing' 
    END as status
FROM (VALUES 
    ('idx_document_chunks_embedding_ivfflat'),
    ('idx_knowledge_documents_user_id'),
    ('idx_document_chunks_document_id'),
    ('idx_knowledge_query_cache_user_hash'),
    ('idx_search_performance_user_time')
) AS i(index_name);

-- 4. Check if all key functions exist
SELECT 
    function_name,
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = f.function_name) 
         THEN '✓ Exists' 
         ELSE '✗ Missing' 
    END as status
FROM (VALUES 
    ('search_knowledge_optimized'),
    ('get_knowledge_base_size'),
    ('analyze_knowledge_search_performance'),
    ('refresh_optimization_data'),
    ('cache_knowledge_search'),
    ('get_cached_knowledge_search'),
    ('cleanup_expired_cache'),
    ('get_search_performance_summary')
) AS f(function_name);

-- 5. Check materialized view existence
SELECT 
    'mv_document_stats' as view_name,
    CASE WHEN EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'mv_document_stats') 
         THEN '✓ Exists' 
         ELSE '✗ Missing' 
    END as status;

-- 6. Test basic functionality
-- Create a test user and document
DO $$
DECLARE
    test_user_id UUID := '00000000-0000-0000-0000-000000000001';
    test_doc_id UUID;
    test_embedding VECTOR(1536) := (SELECT array_agg(random())::VECTOR(1536) FROM generate_series(1, 1536));
BEGIN
    -- Create test user document
    INSERT INTO knowledge_documents (id, user_id, title, content, metadata)
    VALUES (
        gen_random_uuid(),
        test_user_id,
        'Performance Test Document',
        'This is a test document for performance verification',
        '{"test": true, "created": "performance_verification"}'::jsonb
    ) RETURNING id INTO test_doc_id;
    
    -- Create test chunks
    INSERT INTO document_chunks (document_id, content, embedding, chunk_index, metadata)
    VALUES 
        (test_doc_id, 'Test chunk 1 content', test_embedding, 1, '{"test": true}'::jsonb),
        (test_doc_id, 'Test chunk 2 content', test_embedding, 2, '{"test": true}'::jsonb);
    
    -- Test search function
    PERFORM search_knowledge_optimized(test_user_id, test_embedding, 10, 0.22);
    
    -- Test size function
    PERFORM get_knowledge_base_size(test_user_id);
    
    -- Clean up test data
    DELETE FROM document_chunks WHERE document_id IN (
        SELECT id FROM knowledge_documents WHERE user_id = test_user_id
    );
    DELETE FROM knowledge_documents WHERE user_id = test_user_id;
    
    RAISE NOTICE '✓ Basic functionality test passed';
END $$;

-- 7. Check index usage statistics
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
    AND tablename IN ('knowledge_documents', 'document_chunks', 'knowledge_query_cache')
ORDER BY idx_scan DESC;

-- 8. Check table sizes
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size
FROM pg_tables
WHERE schemaname = 'public'
    AND tablename IN ('knowledge_documents', 'document_chunks', 'knowledge_query_cache', 'search_performance_stats')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- 9. Check vector index configuration
SELECT 
    c.relname as table_name,
    i.relname as index_name,
    am.amname as index_type,
    pg_size_pretty(pg_relation_size(i.oid)) as index_size,
    (SELECT string_agg(attname, ', ') 
     FROM pg_attribute 
     WHERE attrelid = i.oid AND attnum > 0) as index_columns
FROM pg_class c
JOIN pg_index ix ON c.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_am am ON am.oid = i.relam
WHERE c.relname IN ('document_chunks')
    AND am.amname IN ('ivfflat', 'hnsw');

-- 10. Performance benchmark test
DO $$
DECLARE
    start_time TIMESTAMP;
    end_time TIMESTAMP;
    execution_time INTERVAL;
    test_user_id UUID := '00000000-0000-0000-0000-000000000001';
    test_embedding VECTOR(1536) := (SELECT array_agg(random())::VECTOR(1536) FROM generate_series(1, 1536));
    result_count INTEGER;
BEGIN
    start_time := clock_timestamp();
    
    -- Run optimized search
    SELECT COUNT(*) INTO result_count
    FROM search_knowledge_optimized(test_user_id, test_embedding, 10, 0.22);
    
    end_time := clock_timestamp();
    execution_time := end_time - start_time;
    
    RAISE NOTICE '✓ Performance benchmark: Found % results in % ms', 
                 result_count, 
                 EXTRACT(MILLISECONDS FROM execution_time);
END $$;

-- 11. Check for any missing indexes or performance issues
SELECT 
    'Missing indexes check' as check_name,
    CASE 
        WHEN NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname LIKE '%embedding%') 
        THEN '⚠ No embedding indexes found'
        WHEN NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname LIKE '%user_id%') 
        THEN '⚠ No user_id indexes found'
        ELSE '✓ All critical indexes present'
    END as status;

-- 12. Final status summary
SELECT 
    'Performance optimization verification' as check_type,
    CASE 
        WHEN (SELECT COUNT(*) FROM pg_proc WHERE proname LIKE '%knowledge%') >= 5
         AND (SELECT COUNT(*) FROM pg_indexes WHERE indexname LIKE '%knowledge%' OR indexname LIKE '%document%') >= 3
         AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
        THEN '✓ All optimizations verified successfully'
        ELSE '⚠ Some optimizations may be missing'
    END as final_status;
