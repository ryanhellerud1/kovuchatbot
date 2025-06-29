import { Document } from '@langchain/core/documents';
import { LangChainDocument } from '@/lib/ai/langchain-types';
import { withLangChainErrorHandling, shouldUseLangChain } from '@/lib/ai/langchain-utils';
import { 
  processDocument as legacyProcessDocument,
  ProcessedDocument as LegacyProcessedDocument 
} from './retriever';
import { 
  processDocumentWithLangChain,
  LangChainProcessedDocument,
  LangChainSupportedFileType 
} from './langchain-document-processor';
import { searchKnowledgeBase as legacySearchKnowledgeBase } from './retriever';
import { queryLangChainRAG } from './langchain-retrieval-chain';
import { getUserDocumentChunks } from '@/lib/db/queries';

/**
 * Migration comparison result
 */
export interface MigrationComparison {
  legacy: {
    chunkCount: number;
    avgChunkSize: number;
    processingTime: number;
    embeddingDimensions: number;
  };
  langchain: {
    chunkCount: number;
    avgChunkSize: number;
    processingTime: number;
    embeddingDimensions: number;
  };
  differences: {
    chunkCountDiff: number;
    avgChunkSizeDiff: number;
    processingTimeDiff: number;
    chunkSizeVariance: number;
  };
  recommendation: 'legacy' | 'langchain' | 'equivalent';
}

/**
 * Unified document processing that chooses between legacy and LangChain
 */
export async function processDocumentUnified(
  file: Buffer,
  fileName: string,
  fileType: string,
  options: {
    forceLangChain?: boolean;
    forceLegacy?: boolean;
    compare?: boolean;
  } = {}
): Promise<{
  result: LegacyProcessedDocument | LangChainProcessedDocument;
  usedLangChain: boolean;
  comparison?: MigrationComparison;
}> {
  return withLangChainErrorHandling('processDocumentUnified', async () => {
    const shouldUseLangChainProcessing = 
      options.forceLangChain || 
      (!options.forceLegacy && shouldUseLangChain('langchain-gpt-3.5-turbo'));

    if (options.compare) {
      // Run both implementations for comparison
      console.log('[Migration] Running comparison between legacy and LangChain processing');
      
      const [legacyResult, langchainResult] = await Promise.all([
        legacyProcessDocument(file, fileName, fileType as any),
        processDocumentWithLangChain(file, fileName, fileType as LangChainSupportedFileType),
      ]);

      const comparison = createProcessingComparison(legacyResult, langchainResult);
      
      // Return the recommended result
      const useRecommended = comparison.recommendation === 'langchain';
      
      return {
        result: useRecommended ? langchainResult : legacyResult,
        usedLangChain: useRecommended,
        comparison,
      };
    } else if (shouldUseLangChainProcessing) {
      // Use LangChain processing
      console.log('[Migration] Using LangChain document processing');
      
      const result = await processDocumentWithLangChain(
        file, 
        fileName, 
        fileType as LangChainSupportedFileType
      );
      
      return {
        result,
        usedLangChain: true,
      };
    } else {
      // Use legacy processing
      console.log('[Migration] Using legacy document processing');
      
      const result = await legacyProcessDocument(file, fileName, fileType as any);
      
      return {
        result,
        usedLangChain: false,
      };
    }
  });
}

/**
 * Unified search that chooses between legacy and LangChain
 */
export async function searchKnowledgeUnified(
  query: string,
  userId: string,
  options: {
    limit?: number;
    minSimilarity?: number;
    forceLangChain?: boolean;
    forceLegacy?: boolean;
    includeAnswer?: boolean;
  } = {}
): Promise<{
  results: any[];
  answer?: string;
  usedLangChain: boolean;
  metadata?: any;
}> {
  return withLangChainErrorHandling('searchKnowledgeUnified', async () => {
    const shouldUseLangChainSearch = 
      options.forceLangChain || 
      (!options.forceLegacy && shouldUseLangChain('langchain-gpt-3.5-turbo'));

    if (shouldUseLangChainSearch) {
      console.log('[Migration] Using LangChain RAG search');
      
      if (options.includeAnswer) {
        // Use full RAG with answer generation
        const ragResult = await queryLangChainRAG(userId, query, {
          retrievalK: options.limit,
          scoreThreshold: options.minSimilarity,
        });
        
        return {
          results: ragResult.sources.map((source, index) => ({
            rank: index + 1,
            content: source.content,
            similarity: source.score || 0,
            source: {
              document: source.document,
              documentId: '', // Not available in this format
              section: 'LangChain Chunk',
            },
            relevanceScore: getRelevanceLabel(source.score || 0),
          })),
          answer: ragResult.answer,
          usedLangChain: true,
          metadata: ragResult.metadata,
        };
      } else {
        // Use retrieval only (would need to implement retrieval-only function)
        // For now, fall back to legacy for retrieval-only
        console.log('[Migration] Falling back to legacy for retrieval-only search');
        return searchLegacy();
      }
    } else {
      console.log('[Migration] Using legacy search');
      return searchLegacy();
    }

    async function searchLegacy() {
      const searchResults = await legacySearchKnowledgeBase(query, userId, {
        limit: options.limit,
        minSimilarity: options.minSimilarity,
        includeMetadata: true,
      });

      const formattedResults = searchResults.map((result, index) => ({
        rank: index + 1,
        content: result.content,
        similarity: result.similarity,
        source: {
          document: result.source.documentTitle,
          documentId: result.source.documentId,
          section: `Chunk ${result.source.chunkIndex + 1}`,
        },
        relevanceScore: getRelevanceLabel(result.similarity),
      }));

      return {
        results: formattedResults,
        usedLangChain: false,
      };
    }
  });
}

/**
 * Convert legacy document chunks to LangChain documents
 */
export async function convertLegacyChunksToLangChain(
  userId: string
): Promise<LangChainDocument[]> {
  return withLangChainErrorHandling('convertLegacyChunks', async () => {
    console.log(`[Migration] Converting legacy chunks to LangChain format for user ${userId}`);
    
    const chunks = await getUserDocumentChunks(userId);
    
    const langchainDocs: LangChainDocument[] = chunks.map(chunk => {
      const doc = new Document({
        pageContent: chunk.content,
        metadata: {
          id: chunk.id,
          documentId: chunk.documentId,
          documentTitle: chunk.documentTitle,
          chunkIndex: chunk.chunkIndex,
          source: chunk.documentTitle,
          originalEmbedding: chunk.embedding,
          ...chunk.chunkMetadata,
        },
      }) as LangChainDocument;
      
      return doc;
    });
    
    console.log(`[Migration] Converted ${langchainDocs.length} chunks to LangChain format`);
    return langchainDocs;
  });
}

/**
 * Create processing comparison between legacy and LangChain
 */
function createProcessingComparison(
  legacy: LegacyProcessedDocument,
  langchain: LangChainProcessedDocument
): MigrationComparison {
  const legacyAvgChunkSize = legacy.chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) / legacy.chunks.length;
  const langchainAvgChunkSize = langchain.metadata.avgChunkSize;
  
  const legacyChunkSizes = legacy.chunks.map(chunk => chunk.content.length);
  const langchainChunkSizes = langchain.documents.map(doc => doc.pageContent.length);
  
  const legacyVariance = calculateVariance(legacyChunkSizes);
  const langchainVariance = calculateVariance(langchainChunkSizes);
  
  const comparison: MigrationComparison = {
    legacy: {
      chunkCount: legacy.chunks.length,
      avgChunkSize: legacyAvgChunkSize,
      processingTime: 0, // Not tracked in legacy
      embeddingDimensions: legacy.embeddings[0]?.length || 0,
    },
    langchain: {
      chunkCount: langchain.metadata.chunkCount,
      avgChunkSize: langchainAvgChunkSize,
      processingTime: langchain.metadata.processingTime,
      embeddingDimensions: langchain.embeddings[0]?.length || 0,
    },
    differences: {
      chunkCountDiff: langchain.metadata.chunkCount - legacy.chunks.length,
      avgChunkSizeDiff: langchainAvgChunkSize - legacyAvgChunkSize,
      processingTimeDiff: langchain.metadata.processingTime,
      chunkSizeVariance: langchainVariance - legacyVariance,
    },
    recommendation: 'equivalent', // Default
  };
  
  // Determine recommendation based on metrics
  if (Math.abs(comparison.differences.chunkCountDiff) < 2 && 
      Math.abs(comparison.differences.avgChunkSizeDiff) < 100) {
    comparison.recommendation = 'equivalent';
  } else if (comparison.differences.chunkSizeVariance < 0) {
    // LangChain has more consistent chunk sizes
    comparison.recommendation = 'langchain';
  } else {
    comparison.recommendation = 'legacy';
  }
  
  return comparison;
}

/**
 * Calculate variance of an array of numbers
 */
function calculateVariance(numbers: number[]): number {
  const mean = numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
  const squaredDiffs = numbers.map(num => Math.pow(num - mean, 2));
  return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / numbers.length;
}

/**
 * Get relevance label for similarity score
 */
function getRelevanceLabel(similarity: number): string {
  if (similarity >= 0.8) return 'Highly Relevant';
  if (similarity >= 0.65) return 'Very Relevant';
  if (similarity >= 0.5) return 'Relevant';
  if (similarity >= 0.3) return 'Somewhat Relevant';
  return 'Low Relevance';
}

/**
 * Migrate existing user documents to LangChain format
 */
export async function migrateUserDocumentsToLangChain(
  userId: string,
  options: {
    dryRun?: boolean;
    batchSize?: number;
  } = {}
): Promise<{
  totalDocuments: number;
  migratedDocuments: number;
  errors: string[];
  dryRun: boolean;
}> {
  return withLangChainErrorHandling('migrateUserDocuments', async () => {
    const { dryRun = false, batchSize = 10 } = options;
    
    console.log(`[Migration] ${dryRun ? 'Dry run' : 'Migrating'} user documents to LangChain for user ${userId}`);
    
    const chunks = await getUserDocumentChunks(userId);
    const documentGroups = groupChunksByDocument(chunks);
    
    const errors: string[] = [];
    let migratedDocuments = 0;
    
    for (const [documentId, documentChunks] of Object.entries(documentGroups)) {
      try {
        if (!dryRun) {
          // Convert chunks to LangChain documents
          const langchainDocs = documentChunks.map(chunk => new Document({
            pageContent: chunk.content,
            metadata: {
              documentId: chunk.documentId,
              documentTitle: chunk.documentTitle,
              chunkIndex: chunk.chunkIndex,
              originalId: chunk.id,
              migratedAt: new Date().toISOString(),
            },
          }));
          
          // Here you would save the LangChain documents
          // This would require implementing a save function for LangChain format
          console.log(`[Migration] Would migrate ${langchainDocs.length} chunks for document ${documentId}`);
        }
        
        migratedDocuments++;
      } catch (error) {
        const errorMsg = `Failed to migrate document ${documentId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(`[Migration] ${errorMsg}`);
      }
    }
    
    return {
      totalDocuments: Object.keys(documentGroups).length,
      migratedDocuments,
      errors,
      dryRun,
    };
  });
}

/**
 * Group chunks by document ID
 */
function groupChunksByDocument(chunks: any[]): Record<string, any[]> {
  return chunks.reduce((groups, chunk) => {
    const documentId = chunk.documentId;
    if (!groups[documentId]) {
      groups[documentId] = [];
    }
    groups[documentId].push(chunk);
    return groups;
  }, {} as Record<string, any[]>);
}

/**
 * Performance benchmark between legacy and LangChain
 */
export async function benchmarkRAGPerformance(
  userId: string,
  testQueries: string[],
  options: {
    iterations?: number;
    includeAccuracy?: boolean;
  } = {}
): Promise<{
  legacy: {
    avgResponseTime: number;
    avgResultCount: number;
    totalQueries: number;
  };
  langchain: {
    avgResponseTime: number;
    avgResultCount: number;
    totalQueries: number;
  };
  comparison: {
    speedDifference: number; // Positive means LangChain is faster
    resultCountDifference: number;
    recommendation: 'legacy' | 'langchain';
  };
}> {
  const { iterations = 1 } = options;
  
  console.log(`[Migration] Benchmarking RAG performance with ${testQueries.length} queries, ${iterations} iterations`);
  
  const legacyTimes: number[] = [];
  const langchainTimes: number[] = [];
  const legacyResultCounts: number[] = [];
  const langchainResultCounts: number[] = [];
  
  for (let i = 0; i < iterations; i++) {
    for (const query of testQueries) {
      // Benchmark legacy
      const legacyStart = Date.now();
      const legacyResults = await legacySearchKnowledgeBase(query, userId, { limit: 5 });
      const legacyTime = Date.now() - legacyStart;
      legacyTimes.push(legacyTime);
      legacyResultCounts.push(legacyResults.length);
      
      // Benchmark LangChain
      const langchainStart = Date.now();
      const langchainResults = await queryLangChainRAG(userId, query, { retrievalK: 5 });
      const langchainTime = Date.now() - langchainStart;
      langchainTimes.push(langchainTime);
      langchainResultCounts.push(langchainResults.sources.length);
    }
  }
  
  const avgLegacyTime = legacyTimes.reduce((sum, time) => sum + time, 0) / legacyTimes.length;
  const avgLangchainTime = langchainTimes.reduce((sum, time) => sum + time, 0) / langchainTimes.length;
  const avgLegacyResults = legacyResultCounts.reduce((sum, count) => sum + count, 0) / legacyResultCounts.length;
  const avgLangchainResults = langchainResultCounts.reduce((sum, count) => sum + count, 0) / langchainResultCounts.length;
  
  const speedDifference = avgLegacyTime - avgLangchainTime;
  const resultCountDifference = avgLangchainResults - avgLegacyResults;
  
  return {
    legacy: {
      avgResponseTime: avgLegacyTime,
      avgResultCount: avgLegacyResults,
      totalQueries: legacyTimes.length,
    },
    langchain: {
      avgResponseTime: avgLangchainTime,
      avgResultCount: avgLangchainResults,
      totalQueries: langchainTimes.length,
    },
    comparison: {
      speedDifference,
      resultCountDifference,
      recommendation: speedDifference > 0 ? 'langchain' : 'legacy',
    },
  };
}