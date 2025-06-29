import { generateEmbedding } from './embeddings';
import { cosineSimilarity, findTopSimilar } from './similarity';
import { getUserDocumentChunks } from '@/lib/db/queries';

/**
 * Search result with content and metadata
 */
export interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  source: {
    documentId: string;
    documentTitle: string;
    chunkIndex: number;
  };
  metadata?: any;
}

/**
 * Search options for document retrieval
 */
export interface SearchOptions {
  limit?: number;
  minSimilarity?: number;
  includeMetadata?: boolean;
}

/**
 * Search user's personal knowledge base for relevant content
 */
export async function searchKnowledgeBase(
  query: string,
  userId: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const { limit = 10, minSimilarity = 0.4, includeMetadata = true } = options;

  try {
    console.log(`[searchKnowledgeBase] Starting search for user ${userId} with query: "${query}"`);
    
    // Generate embedding for the search query
    const queryEmbedding = await generateEmbedding(query);
    console.log(`[searchKnowledgeBase] Generated query embedding with ${queryEmbedding.length} dimensions`);

    // Get all user's document chunks with embeddings
    const chunks = await getUserDocumentChunks(userId);
    console.log(`[searchKnowledgeBase] Retrieved ${chunks.length} chunks from database`);

    if (chunks.length === 0) {
      return [];
    }

    // Calculate similarity scores
    const results: SearchResult[] = [];
    let validChunks = 0;
    let invalidChunks = 0;

    for (const chunk of chunks) {
      if (!chunk.embedding) {
        console.warn(`Chunk ${chunk.id} has no embedding, skipping`);
        invalidChunks++;
        continue;
      }

      // Get embedding (already parsed by Drizzle)
      const chunkEmbedding = chunk.embedding as number[] | null;
      if (!Array.isArray(chunkEmbedding)) {
        console.warn(`Chunk ${chunk.id} has invalid embedding format`);
        invalidChunks++;
        continue;
      }

      validChunks++;

      // Calculate similarity
      const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);

      // Only include results above similarity threshold
      if (similarity >= minSimilarity) {
        results.push({
          id: chunk.id,
          content: chunk.content,
          similarity,
          source: {
            documentId: chunk.documentId,
            documentTitle: chunk.documentTitle,
            chunkIndex: chunk.chunkIndex,
          },
          metadata: includeMetadata ? chunk.chunkMetadata : undefined,
        });
      }
    }

    console.log(`[searchKnowledgeBase] Processed ${validChunks} valid chunks, ${invalidChunks} invalid chunks`);
    console.log(`[searchKnowledgeBase] Found ${results.length} results above similarity threshold ${minSimilarity}`);
    
    if (results.length > 0) {
      const similarities = results.map(r => r.similarity);
      console.log(`[searchKnowledgeBase] Similarity range: ${Math.min(...similarities).toFixed(3)} - ${Math.max(...similarities).toFixed(3)}`);
    }

    // Sort by similarity (highest first) and limit results
    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  } catch (error) {
    console.error('Error searching knowledge base:', error);
    throw new Error('Failed to search knowledge base');
  }
}

/**
 * Search for similar content within a specific document
 */
export async function searchWithinDocument(
  query: string,
  documentId: string,
  userId: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const { limit = 3, minSimilarity = 0.4, includeMetadata = true } = options;

  try {
    // Generate embedding for the search query
    const queryEmbedding = await generateEmbedding(query);

    // Get chunks for the specific document
    const chunks = await getUserDocumentChunks(userId);
    const documentChunks = chunks.filter(
      (chunk) => chunk.documentId === documentId,
    );

    if (documentChunks.length === 0) {
      return [];
    }

    // Calculate similarity scores and filter
    const results: SearchResult[] = [];

    for (const chunk of documentChunks) {
      if (!chunk.embedding) continue;

      const chunkEmbedding = chunk.embedding as number[] | null;
      if (!Array.isArray(chunkEmbedding)) {
        continue;
      }

      const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);

      if (similarity >= minSimilarity) {
        results.push({
          id: chunk.id,
          content: chunk.content,
          similarity,
          source: {
            documentId: chunk.documentId,
            documentTitle: chunk.documentTitle,
            chunkIndex: chunk.chunkIndex,
          },
          metadata: includeMetadata ? chunk.chunkMetadata : undefined,
        });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  } catch (error) {
    console.error('Error searching within document:', error);
    throw new Error('Failed to search within document');
  }
}

/**
 * Get related content based on a document chunk
 */
export async function getRelatedContent(
  chunkId: string,
  userId: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const { limit = 5, minSimilarity = 0.4 } = options;

  try {
    // Get all user's chunks
    const chunks = await getUserDocumentChunks(userId);

    // Find the source chunk
    const sourceChunk = chunks.find((chunk) => chunk.id === chunkId);
    if (!sourceChunk || !sourceChunk.embedding) {
      return [];
    }

    const sourceEmbedding = sourceChunk.embedding as number[] | null;
    if (!Array.isArray(sourceEmbedding)) {
      return [];
    }

    // Find similar chunks (excluding the source chunk itself)
    const results: SearchResult[] = [];

    for (const chunk of chunks) {
      if (chunk.id === chunkId || !chunk.embedding) continue;

      const chunkEmbedding = chunk.embedding as number[] | null;
      if (!Array.isArray(chunkEmbedding)) {
        continue;
      }

      const similarity = cosineSimilarity(sourceEmbedding, chunkEmbedding);

      if (similarity >= minSimilarity) {
        results.push({
          id: chunk.id,
          content: chunk.content,
          similarity,
          source: {
            documentId: chunk.documentId,
            documentTitle: chunk.documentTitle,
            chunkIndex: chunk.chunkIndex,
          },
        });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  } catch (error) {
    console.error('Error getting related content:', error);
    throw new Error('Failed to get related content');
  }
}
