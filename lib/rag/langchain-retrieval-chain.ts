import type { ChatOpenAI } from '@langchain/openai';
import { RetrievalQAChain } from 'langchain/chains';
import { PromptTemplate } from '@langchain/core/prompts';
import type { Document } from '@langchain/core/documents';
import { PostgreSQLRetriever, createPostgreSQLRetriever } from './langchain-vector-store';
import { getLangChainModel } from '@/lib/ai/langchain-providers';
import { withLangChainErrorHandling, withLangChainTiming } from '@/lib/ai/langchain-utils';
import type { LangChainSearchResult } from '@/lib/ai/langchain-types';

/**
 * LangChain RAG chain configuration
 */
export interface LangChainRAGConfig {
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  retrievalK?: number;
  scoreThreshold?: number;
  returnSourceDocuments?: boolean;
  chainType?: 'stuff' | 'map_reduce' | 'refine' | 'map_rerank';
}

/**
 * Default RAG configuration
 */
export const DEFAULT_RAG_CONFIG: LangChainRAGConfig = {
  modelId: 'langchain-gpt-3.5-turbo',
  temperature: 0.1,
  maxTokens: 1000,
  retrievalK: 5,
  scoreThreshold: 0.4,
  returnSourceDocuments: true,
  chainType: 'stuff',
};

/**
 * Custom prompt template for RAG
 */
const RAG_PROMPT_TEMPLATE = `You are a helpful AI assistant that answers questions based on the provided context from the user's documents.

Context from user's documents:
{context}

Question: {question}

Instructions:
- Answer the question based on the provided context
- If the context doesn't contain enough information to answer the question, say so clearly
- Cite specific parts of the context when relevant
- Be concise but comprehensive
- If multiple documents are referenced, mention which documents the information comes from

Answer:`;

/**
 * LangChain RAG implementation
 */
export class LangChainRAG {
  private model: ChatOpenAI;
  private retriever: PostgreSQLRetriever;
  private chain: RetrievalQAChain;
  private config: LangChainRAGConfig;

  constructor(
    model: ChatOpenAI,
    retriever: PostgreSQLRetriever,
    config: LangChainRAGConfig
  ) {
    this.model = model;
    this.retriever = retriever;
    this.config = config;
    this.chain = this.createChain();
  }

  /**
   * Create the retrieval QA chain
   */
  private createChain(): RetrievalQAChain {
    const prompt = new PromptTemplate({
      template: RAG_PROMPT_TEMPLATE,
      inputVariables: ['context', 'question'],
    });

    return RetrievalQAChain.fromLLM(this.model, this.retriever as any, {
      prompt,
      returnSourceDocuments: this.config.returnSourceDocuments,
      chainType: this.config.chainType || 'stuff',
    });
  }

  /**
   * Query the RAG system
   */
  async query(
    question: string,
    options: {
      includeSourceDocuments?: boolean;
      customK?: number;
      customScoreThreshold?: number;
    } = {}
  ): Promise<{
    answer: string;
    sourceDocuments?: Document[];
    metadata: {
      retrievedDocuments: number;
      processingTime: number;
      modelUsed: string;
    };
  }> {
    return withLangChainErrorHandling('ragQuery', async () => {
      return withLangChainTiming('ragQuery', async () => {
        const startTime = Date.now();
        
        console.log(`[LangChain RAG] Processing query: "${question}"`);

        // Override retriever settings if provided
        if (options.customK || options.customScoreThreshold) {
          // Create a new retriever with custom settings
          const customRetriever = new PostgreSQLRetriever(
            (this.retriever as any).vectorStore,
            {
              k: options.customK || this.config.retrievalK,
              scoreThreshold: options.customScoreThreshold || this.config.scoreThreshold,
            }
          );
          
          // Update the chain with the new retriever
          this.chain = RetrievalQAChain.fromLLM(this.model, customRetriever as any, {
            prompt: new PromptTemplate({
              template: RAG_PROMPT_TEMPLATE,
              inputVariables: ['context', 'question'],
            }),
            returnSourceDocuments: options.includeSourceDocuments ?? this.config.returnSourceDocuments,
            chainType: this.config.chainType || 'stuff',
          });
        }

        // Execute the chain
        const result = await this.chain.call({
          query: question,
        });

        const processingTime = Date.now() - startTime;
        
        console.log(`[LangChain RAG] Query processed in ${processingTime}ms`);
        console.log(`[LangChain RAG] Retrieved ${result.sourceDocuments?.length || 0} source documents`);

        return {
          answer: result.text,
          sourceDocuments: result.sourceDocuments,
          metadata: {
            retrievedDocuments: result.sourceDocuments?.length || 0,
            processingTime,
            modelUsed: this.config.modelId,
          },
        };
      });
    });
  }

  /**
   * Get relevant documents without generating an answer
   */
  async retrieveDocuments(
    query: string,
    k?: number,
    scoreThreshold?: number
  ): Promise<LangChainSearchResult[]> {
    return withLangChainErrorHandling('retrieveDocuments', async () => {
      console.log(`[LangChain RAG] Retrieving documents for: "${query}"`);

      // Create temporary retriever with custom settings if provided
      let retriever = this.retriever;
      if (k || scoreThreshold) {
        retriever = new PostgreSQLRetriever(
          (this.retriever as any).vectorStore,
          {
            k: k || this.config.retrievalK,
            scoreThreshold: scoreThreshold || this.config.scoreThreshold,
          }
        );
      }

      const documents = await retriever.getRelevantDocuments(query);

      // Convert to LangChainSearchResult format
      const results: LangChainSearchResult[] = documents.map((doc, index) => ({
        document: doc as any,
        score: doc.metadata.score || 0, // Score might not be available in this context
        relevanceScore: this.getRelevanceLabel(doc.metadata.score || 0),
      }));

      console.log(`[LangChain RAG] Retrieved ${results.length} documents`);
      return results;
    });
  }

  /**
   * Add documents to the RAG system
   */
  async addDocuments(
    documents: Document[],
    options?: {
      documentTitle?: string;
      fileType?: string;
      fileSize?: number;
    }
  ): Promise<string[]> {
    return withLangChainErrorHandling('addDocuments', async () => {
      console.log(`[LangChain RAG] Adding ${documents.length} documents to RAG system`);
      
      const ids = await this.retriever.addDocuments(documents, options);
      
      console.log(`[LangChain RAG] Successfully added ${documents.length} documents`);
      return ids;
    });
  }

  /**
   * Update RAG configuration
   */
  updateConfig(newConfig: Partial<LangChainRAGConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Update model if modelId changed
    if (newConfig.modelId) {
      this.model = getLangChainModel(newConfig.modelId);
      if (newConfig.temperature !== undefined) {
        this.model.temperature = newConfig.temperature;
      }
      if (newConfig.maxTokens !== undefined) {
        this.model.maxTokens = newConfig.maxTokens;
      }
    }
    
    // Recreate chain with new configuration
    this.chain = this.createChain();
    
    console.log('[LangChain RAG] Configuration updated');
  }

  /**
   * Get relevance label for score
   */
  private getRelevanceLabel(score: number): string {
    if (score >= 0.8) return 'Highly Relevant';
    if (score >= 0.65) return 'Very Relevant';
    if (score >= 0.5) return 'Relevant';
    if (score >= 0.3) return 'Somewhat Relevant';
    return 'Low Relevance';
  }

  /**
   * Get current configuration
   */
  getConfig(): LangChainRAGConfig {
    return { ...this.config };
  }
}

/**
 * Factory function to create LangChain RAG system
 */
export async function createLangChainRAG(
  userId: string,
  config: Partial<LangChainRAGConfig> = {}
): Promise<LangChainRAG> {
  const finalConfig = { ...DEFAULT_RAG_CONFIG, ...config };
  
  console.log(`[LangChain RAG] Creating RAG system for user ${userId}`);
  
  // Create model
  const model = getLangChainModel(finalConfig.modelId);
  if (finalConfig.temperature !== undefined) {
    model.temperature = finalConfig.temperature;
  }
  if (finalConfig.maxTokens !== undefined) {
    model.maxTokens = finalConfig.maxTokens;
  }
  
  // Create retriever
  const retriever = await createPostgreSQLRetriever(userId, {
    k: finalConfig.retrievalK,
    scoreThreshold: finalConfig.scoreThreshold,
  });
  
  return new LangChainRAG(model, retriever, finalConfig);
}

/**
 * Simple RAG query function for easy integration
 */
export async function queryLangChainRAG(
  userId: string,
  question: string,
  config?: Partial<LangChainRAGConfig>
): Promise<{
  answer: string;
  sources: Array<{
    content: string;
    document: string;
    score?: number;
  }>;
  metadata: {
    retrievedDocuments: number;
    processingTime: number;
    modelUsed: string;
  };
}> {
  const rag = await createLangChainRAG(userId, config);
  const result = await rag.query(question, { includeSourceDocuments: true });
  
  // Format sources for easier consumption
  const sources = (result.sourceDocuments || []).map(doc => ({
    content: doc.pageContent,
    document: doc.metadata.documentTitle || doc.metadata.source || 'Unknown Document',
    score: doc.metadata.score,
  }));
  
  return {
    answer: result.answer,
    sources,
    metadata: result.metadata,
  };
}

/**
 * Batch processing for multiple queries
 */
export async function batchQueryLangChainRAG(
  userId: string,
  questions: string[],
  config?: Partial<LangChainRAGConfig>
): Promise<Array<{
  question: string;
  answer: string;
  sources: Array<{
    content: string;
    document: string;
    score?: number;
  }>;
  metadata: {
    retrievedDocuments: number;
    processingTime: number;
    modelUsed: string;
  };
}>> {
  const rag = await createLangChainRAG(userId, config);
  
  const results = await Promise.all(
    questions.map(async (question) => {
      const result = await rag.query(question, { includeSourceDocuments: true });
      
      const sources = (result.sourceDocuments || []).map(doc => ({
        content: doc.pageContent,
        document: doc.metadata.documentTitle || doc.metadata.source || 'Unknown Document',
        score: doc.metadata.score,
      }));
      
      return {
        question,
        answer: result.answer,
        sources,
        metadata: result.metadata,
      };
    })
  );
  
  return results;
}