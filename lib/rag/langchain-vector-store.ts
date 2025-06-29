import { VectorStore } from '@langchain/core/vectorstores';
import { Document } from '@langchain/core/documents';
import { Embeddings } from '@langchain/core/embeddings';
import { createLangChainEmbeddings } from '@/lib/ai/langchain-providers';
import { LangChainDocument, LangChainSearchResult } from '@/lib/ai/langchain-types';
import { withLangChainErrorHandling, withLangChainTiming } from '@/lib/ai/langchain-utils';
import { getUserDocumentChunks, saveKnowledgeDocument, saveDocumentChunk } from '@/lib/db/queries';
import { cosineSimilarity } from './similarity';

/**
 * Helper function to save multiple document chunks
 */
async function saveDocumentChunks(chunks: Array<{
  documentId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  chunkMetadata?: any;
}>): Promise<void> {
  const chunkPromises = chunks.map(async (chunk) => {
    return saveDocumentChunk({
      documentId: chunk.documentId,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      embedding: chunk.embedding,
      metadata: chunk.chunkMetadata,
    });
  });

  await Promise.all(chunkPromises);
}

/**
 * PostgreSQL-based vector store for LangChain
 * Uses existing database schema with JSON embeddings
 */
export class PostgreSQLVectorStore extends VectorStore {
  private userId: string;
  private embeddings: Embeddings;

  constructor(embeddings: Embeddings, userId: string) {
    super(embeddings, {});
    this.embeddings = embeddings;
    this.userId = userId;
  }

  _vectorstoreType(): string {
    return 'postgresql';
  }

  /**
   * Add documents to the vector store
   */
  async addDocuments(
    documents: Document[],
    options?: { 
      documentId?: string;
      documentTitle?: string;
      fileType?: string;
      fileSize?: number;
      fileUrl?: string;
    }
  ): Promise<string[]> {
    return withLangChainErrorHandling('addDocuments', async () => {
      return withLangChainTiming('addDocuments', async () => {
        console.log(`[LangChain VectorStore] Adding ${documents.length} documents for user ${this.userId}`);

        // Generate embeddings for all documents
        const texts = documents.map(doc => doc.pageContent);
        const embeddings = await this.embeddings.embedDocuments(texts);

        // Save knowledge document if not exists
        let documentId = options?.documentId;
        if (!documentId) {
          const knowledgeDoc = await saveKnowledgeDocument({
            userId: this.userId,
            title: options?.documentTitle || 'Untitled Document',
            content: documents.map(doc => doc.pageContent).join('\n\n'),
            fileType: options?.fileType as any,
            fileSize: options?.fileSize,
            fileUrl: options?.fileUrl,
            metadata: {
              chunkCount: documents.length,
              addedAt: new Date().toISOString(),
            },
          });
          documentId = knowledgeDoc.id;
        }

        // Prepare document chunks for database
        const chunks = documents.map((doc, index) => ({
          documentId: documentId!,
          chunkIndex: index,
          content: doc.pageContent,
          embedding: embeddings[index],
          chunkMetadata: {
            ...doc.metadata,
            chunkSize: doc.pageContent.length,
            addedAt: new Date().toISOString(),
          },
        }));

        // Save chunks to database
        await saveDocumentChunks(chunks);

        console.log(`[LangChain VectorStore] Successfully added ${documents.length} document chunks`);
        
        // Return chunk IDs (we'll generate them in the database)
        return chunks.map((_, index) => `${documentId}_${index}`);
      });
    });
  }

  /**
   * Add vectors directly (not typically used with documents)
   */
  async addVectors(vectors: number[][], documents: Document[]): Promise<string[]> {
    return withLangChainErrorHandling('addVectors', async () => {
      console.log(`[LangChain VectorStore] Adding ${vectors.length} vectors directly`);

      // This is similar to addDocuments but with pre-computed embeddings
      const chunks = documents.map((doc, index) => ({
        documentId: doc.metadata.documentId || 'unknown',
        chunkIndex: index,
        content: doc.pageContent,
        embedding: vectors[index],
        chunkMetadata: {
          ...doc.metadata,
          chunkSize: doc.pageContent.length,
          addedAt: new Date().toISOString(),
        },
      }));

      await saveDocumentChunks(chunks);
      
      return chunks.map((_, index) => `${chunks[0].documentId}_${index}`);
    });
  }

  /**
   * Similarity search with score
   */
  async similaritySearchWithScore(
    query: string,
    k: number = 4,
    filter?: Record<string, any>
  ): Promise<[Document, number][]> {
    return withLangChainErrorHandling('similaritySearchWithScore', async () => {
      return withLangChainTiming('similaritySearchWithScore', async () => {
        console.log(`[LangChain VectorStore] Performing similarity search for: "${query}"`);

        // Generate embedding for query
        const queryEmbedding = await this.embeddings.embedQuery(query);

        // Get all user's document chunks
        const chunks = await getUserDocumentChunks(this.userId);
        console.log(`[LangChain VectorStore] Retrieved ${chunks.length} chunks from database`);

        if (chunks.length === 0) {
          return [];
        }

        // Calculate similarities and create results
        const results: Array<{ document: Document; score: number }> = [];

        for (const chunk of chunks) {
          if (!chunk.embedding || !Array.isArray(chunk.embedding)) {
            continue;
          }

          // Apply filters if provided
          if (filter && !this.matchesFilter(chunk, filter)) {
            continue;
          }

          const similarity = cosineSimilarity(queryEmbedding, chunk.embedding as number[]);

          // Convert chunk to LangChain Document
          const document = new Document({
            pageContent: chunk.content,
            metadata: {
              id: chunk.id,
              documentId: chunk.documentId,
              documentTitle: chunk.documentTitle,
              chunkIndex: chunk.chunkIndex,
              source: chunk.documentTitle,
              ...chunk.chunkMetadata,
            },
          });

          results.push({ document, score: similarity });
        }

        // Sort by similarity (highest first) and limit results
        results.sort((a, b) => b.score - a.score);
        const topResults = results.slice(0, k);

        console.log(`[LangChain VectorStore] Found ${topResults.length} results`);
        
        if (topResults.length > 0) {
          const scores = topResults.map(r => r.score);
          console.log(`[LangChain VectorStore] Score range: ${Math.min(...scores).toFixed(3)} - ${Math.max(...scores).toFixed(3)}`);
        }

        return topResults.map(result => [result.document, result.score]);
      });
    });
  }

  /**
   * Similarity search (without scores)
   */
  async similaritySearch(
    query: string,
    k: number = 4,
    filter?: Record<string, any>
  ): Promise<Document[]> {
    const results = await this.similaritySearchWithScore(query, k, filter);
    return results.map(([document]) => document);
  }

  /**
   * Delete documents by IDs
   */
  async delete(options?: { ids?: string[]; deleteAll?: boolean }): Promise<void> {
    return withLangChainErrorHandling('delete', async () => {
      console.log('[LangChain VectorStore] Delete operation requested');
      
      if (options?.deleteAll) {
        // This would require implementing a delete all chunks for user function
        console.warn('[LangChain VectorStore] Delete all not implemented yet');
        return;
      }

      if (options?.ids) {
        // This would require implementing delete specific chunks function
        console.warn('[LangChain VectorStore] Delete by IDs not implemented yet');
        return;
      }
    });
  }

  /**
   * Check if chunk matches filter criteria
   */
  private matchesFilter(chunk: any, filter: Record<string, any>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (key === 'documentId' && chunk.documentId !== value) {
        return false;
      }
      if (key === 'documentTitle' && chunk.documentTitle !== value) {
        return false;
      }
      // Add more filter criteria as needed
    }
    return true;
  }

  /**
   * Create a PostgreSQL vector store instance
   */
  static async fromExistingIndex(
    embeddings: Embeddings,
    userId: string
  ): Promise<PostgreSQLVectorStore> {
    return new PostgreSQLVectorStore(embeddings, userId);
  }

  /**
   * Create vector store from documents
   */
  static async fromDocuments(
    documents: Document[],
    embeddings: Embeddings,
    options: {
      userId: string;
      documentTitle?: string;
      fileType?: string;
      fileSize?: number;
      fileUrl?: string;
    }
  ): Promise<PostgreSQLVectorStore> {
    const vectorStore = new PostgreSQLVectorStore(embeddings, options.userId);
    await vectorStore.addDocuments(documents, options);
    return vectorStore;
  }

  /**
   * Create vector store from texts
   */
  static async fromTexts(
    texts: string[],
    metadatas: object[] | object,
    embeddings: Embeddings,
    options: {
      userId: string;
      documentTitle?: string;
    }
  ): Promise<PostgreSQLVectorStore> {
    const documents = texts.map((text, index) => {
      const metadata = Array.isArray(metadatas) ? metadatas[index] : metadatas;
      return new Document({
        pageContent: text,
        metadata: {
          ...metadata,
          chunkIndex: index,
        },
      });
    });

    return PostgreSQLVectorStore.fromDocuments(documents, embeddings, options);
  }
}

/**
 * Factory function to create PostgreSQL vector store
 */
export async function createPostgreSQLVectorStore(
  userId: string,
  embeddings?: Embeddings
): Promise<PostgreSQLVectorStore> {
  const embeddingsInstance = embeddings || createLangChainEmbeddings();
  return PostgreSQLVectorStore.fromExistingIndex(embeddingsInstance, userId);
}

/**
 * LangChain retriever implementation using PostgreSQL vector store
 */
export class PostgreSQLRetriever {
  private vectorStore: PostgreSQLVectorStore;
  private k: number;
  private scoreThreshold: number;
  private filter?: Record<string, any>;

  constructor(
    vectorStore: PostgreSQLVectorStore,
    options: {
      k?: number;
      scoreThreshold?: number;
      filter?: Record<string, any>;
    } = {}
  ) {
    this.vectorStore = vectorStore;
    this.k = options.k || 4;
    this.scoreThreshold = options.scoreThreshold || 0.0;
    this.filter = options.filter;
  }

  /**
   * Retrieve relevant documents for a query
   */
  async getRelevantDocuments(query: string): Promise<Document[]> {
    return withLangChainErrorHandling('getRelevantDocuments', async () => {
      const results = await this.vectorStore.similaritySearchWithScore(
        query,
        this.k,
        this.filter
      );

      // Filter by score threshold
      const filteredResults = results.filter(([, score]) => score >= this.scoreThreshold);

      console.log(`[LangChain Retriever] Retrieved ${filteredResults.length}/${results.length} documents above threshold ${this.scoreThreshold}`);

      return filteredResults.map(([document]) => document);
    });
  }

  /**
   * Add documents to the retriever's vector store
   */
  async addDocuments(
    documents: Document[],
    options?: {
      documentTitle?: string;
      fileType?: string;
      fileSize?: number;
    }
  ): Promise<string[]> {
    return this.vectorStore.addDocuments(documents, options);
  }
}

/**
 * Create a LangChain retriever for PostgreSQL vector store
 */
export async function createPostgreSQLRetriever(
  userId: string,
  options: {
    k?: number;
    scoreThreshold?: number;
    filter?: Record<string, any>;
    embeddings?: Embeddings;
  } = {}
): Promise<PostgreSQLRetriever> {
  const vectorStore = await createPostgreSQLVectorStore(userId, options.embeddings);
  return new PostgreSQLRetriever(vectorStore, options);
}