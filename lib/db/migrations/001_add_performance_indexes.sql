-- Database Performance Optimization Indexes
-- This migration adds indexes to improve knowledge search performance

-- 1. Vector Search Optimization Indexes
-- GIN index for vector similarity search on document_chunks.embedding
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_gin 
ON document_chunks USING gin (embedding) 
WITH (fastupdate = on);

-- 2. Document Lookup Indexes
-- Index for user-based document filtering
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_user_id 
ON knowledge_documents (user_id, created_at DESC);

-- 3. Chunk Relationship Indexes
-- Index for document_id lookups in chunks
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id 
ON document_chunks (document_id, chunk_index);

-- 4. Composite Indexes for Complex Queries
-- Index for similarity search with user filtering
CREATE INDEX IF NOT EXISTS idx_document_chunks_user_optimized 
ON document_chunks (document_id, chunk_index) 
INCLUDE (content, embedding, chunk_metadata);

-- 5. Metadata Search Indexes
-- GIN index for JSON metadata queries
CREATE INDEX IF NOT EXISTS idx_document_chunks_metadata_gin 
ON document_chunks USING gin (chunk_metadata);

-- 6. Full-text Search Support
-- GIN index for content text search
CREATE INDEX IF NOT EXISTS idx_document_chunks_content_gin 
ON document_chunks USING gin (to_tsvector('english', content));

-- 7. Knowledge Documents Optimization
-- Index for title and file type searches
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_title_type 
ON knowledge_documents (user_id, file_type, title);

-- 8. Performance Monitoring Indexes
-- Index for tracking document usage
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_usage 
ON knowledge_documents (user_id, updated_at DESC);

-- 9. Chunk Content Length Index (for optimization)
CREATE INDEX IF NOT EXISTS idx_document_chunks_content_length 
ON document_chunks (document_id, length(content));

-- 10. Vector Dimension Check
-- Ensure vector dimensions are correct for pgvector
ALTER TABLE document_chunks 
ALTER COLUMN embedding TYPE vector(1536) 
USING embedding::vector(1536);

-- 11. Update table statistics for query planner
ANALYZE document_chunks;
ANALYZE knowledge_documents;

-- 12. Enable pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- 13. Set optimal pgvector parameters
SET ivfflat.probes = 10;
SET max_parallel_workers_per_gather = 4;
