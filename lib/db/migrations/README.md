# Database Performance Optimization Migrations

This directory contains SQL migrations to optimize the knowledge base search performance in the KovaChat application.

## Migration Files

### 1. `001_add_performance_indexes.sql`
**Purpose**: Core performance indexes for knowledge search
- **Vector search optimization**: GIN indexes for embedding similarity
- **Document lookup optimization**: Indexes for user-based filtering
- **Chunk relationship indexes**: Fast document-to-chunk lookups
- **Composite indexes**: Optimized for complex similarity queries
- **Metadata search**: GIN indexes for JSON metadata queries
- **Full-text search**: GIN indexes for content text search
- **Performance monitoring**: Indexes for tracking document usage

### 2. `002_optimized_similarity_search.sql`
**Purpose**: Advanced search functions and materialized views
- **Materialized view**: Pre-computed document statistics (`mv_document_stats`)
- **Optimized search function**: `search_knowledge_optimized()` with improved performance
- **Adjacent chunk retrieval**: Efficient function to get context chunks
- **Batch operations**: Functions for bulk chunk retrieval
- **Automatic statistics refresh**: Triggers to keep stats updated
- **Vector index optimization**: IVFFLAT index for similarity search

### 3. `003_query_optimization_helpers.sql`
**Purpose**: Performance monitoring and optimization utilities
- **Performance analysis**: Function to analyze query execution
- **Database size tracking**: Monitor storage usage per user
- **Vector parameter optimization**: Auto-tune search parameters
- **Query caching**: Reduce duplicate search overhead
- **Maintenance utilities**: Cleanup and optimization functions
- **Index usage monitoring**: Track index effectiveness

## Usage Instructions

### Running Migrations
```bash
# Run all migrations in order
psql -d your_database -f 001_add_performance_indexes.sql
psql -d your_database -f 002_optimized_similarity_search.sql
psql -d your_database -f 003_query_optimization_helpers.sql
```

### Key Functions Available

#### Search Functions
- `search_knowledge_optimized(user_id, query_embedding, limit, min_similarity)` - Optimized similarity search
- `get_adjacent_chunks_optimized(user_id, chunks_json)` - Get context chunks efficiently
- `get_chunks_batch(chunk_ids)` - Batch retrieve chunks by ID

#### Performance Monitoring
- `analyze_knowledge_search_performance()` - Analyze query performance
- `get_knowledge_base_size(user_id)` - Get storage statistics
- `get_search_performance_summary(user_id, days)` - Performance metrics

#### Maintenance Functions
- `refresh_optimization_data()` - Refresh all optimization data
- `cleanup_orphaned_chunks()` - Remove orphaned chunks
- `rebuild_vector_indexes()` - Rebuild vector search indexes
- `cleanup_expired_cache()` - Clean expired query cache

#### Cache Management
- `cache_knowledge_search()` - Cache search results
- `get_cached_knowledge_search()` - Retrieve cached results

## Performance Improvements

### Expected Improvements
- **Search speed**: 5-10x faster similarity searches
- **Memory usage**: Reduced memory footprint with optimized indexes
- **Query planning**: Better query plans with updated statistics
- **Cache hit rate**: 30-50% cache hit rate for repeated queries
- **Maintenance**: Automated cleanup and optimization

### Monitoring Queries
```sql
-- Check index usage
SELECT * FROM get_index_usage_stats();

-- Analyze search performance
SELECT * FROM analyze_knowledge_search_performance(
    'user-uuid', 
    'your query text', 
    '[1,2,3,...]'::vector(1536)
);

-- Get database size
SELECT * FROM get_knowledge_base_size('user-uuid');

-- Check cache performance
SELECT * FROM get_search_performance_summary('user-uuid', 7);
```

## Database Requirements
- **PostgreSQL 14+** with pgvector extension
- **pgvector extension** for vector operations
- **Sufficient memory** for index operations (recommended: 1GB+)
- **SSD storage** recommended for optimal performance

## Troubleshooting

### Common Issues
1. **Index creation fails**: Ensure pgvector extension is installed
2. **Slow queries**: Run `ANALYZE` on tables after large data changes
3. **Memory issues**: Adjust PostgreSQL memory settings
4. **Cache bloat**: Run `cleanup_expired_cache()` periodically

### Performance Tuning
```sql
-- Adjust PostgreSQL settings for better performance
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET work_mem = '64MB';
ALTER SYSTEM SET maintenance_work_mem = '256MB';
SELECT pg_reload_conf();
```

## Migration Notes
- All migrations are idempotent (safe to run multiple times)
- Indexes are created with `IF NOT EXISTS` to prevent conflicts
- Functions use `CREATE OR REPLACE` for easy updates
- Materialized views are refreshed automatically via triggers
