import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { searchKnowledgeBase } from '@/lib/rag/retriever';
import { queryLangChainRAG } from '@/lib/rag/langchain-retrieval-chain';
import type { LangChainToolContext } from '../langchain-types';
import { shouldUseLangChain } from '../langchain-utils';

/**
 * LangChain version of the knowledge search tool
 * This demonstrates the migration pattern from AI SDK tools to LangChain tools
 */
export class LangChainSearchKnowledgeTool extends StructuredTool {
  name = 'search_knowledge';
  description = `Search through the user's personal knowledge base of uploaded documents. 
    Use this tool when the user asks questions about their documents, notes, or any content they've uploaded.
    Examples: "What did I learn about React?", "Find information about my project proposal", "Summarize my research notes"`;

  schema = z.object({
    query: z
      .string()
      .describe("The search query to find relevant content in the user's documents"),
    limit: z
      .number()
      .optional()
      .default(5)
      .describe('Maximum number of results to return (1-10)'),
    minSimilarity: z
      .number()
      .optional()
      .default(0.4)
      .describe('Minimum similarity threshold (0.0-1.0)'),
    dynamicThreshold: z
      .boolean()
      .optional()
      .default(true)
      .describe('Automatically adjust threshold based on query length'),
  });

  constructor(private context: LangChainToolContext) {
    super();
  }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const { query, limit = 5, minSimilarity = 0.4, dynamicThreshold = true } = input;

    // Ensure user is authenticated
    if (!this.context.userId) {
      return JSON.stringify({
        error: 'User not authenticated',
        results: [],
      });
    }

    try {
      console.log(`[LangChain SearchKnowledge] Starting search for query: "${query}"`);
      
      // Validate parameters
      const validatedLimit = Math.min(Math.max(limit, 1), 10);
      let validatedSimilarity = Math.min(Math.max(minSimilarity, 0.0), 1.0);

      // Adjust threshold dynamically based on query length
      if (dynamicThreshold) {
        const queryTokens = query.split(/\s+/).length;
        if (queryTokens < 3) {
          // Broader search for short queries
          validatedSimilarity = Math.max(0.3, validatedSimilarity - 0.1);
        } else if (queryTokens > 7) {
          // Only increase threshold for very long queries (8+ words)
          validatedSimilarity = Math.min(0.5, validatedSimilarity + 0.05);
        }
        // For medium queries (3-7 words), keep the original threshold
      }

      console.log(`[LangChain SearchKnowledge] Using similarity threshold: ${validatedSimilarity} (original: ${minSimilarity})`);

      // Check if we should use LangChain RAG or legacy implementation
      const useLangChainRAG = shouldUseLangChain('langchain-gpt-3.5-turbo');
      
      if (useLangChainRAG) {
        console.log('[LangChain SearchKnowledge] Using LangChain RAG implementation');
        
        // Use LangChain RAG for enhanced search
        const ragResult = await queryLangChainRAG(
          this.context.userId,
          query,
          {
            retrievalK: validatedLimit,
            scoreThreshold: validatedSimilarity,
            modelId: 'langchain-gpt-3.5-turbo',
            temperature: 0.1,
          }
        );

        // Format response in expected format
        const response = {
          query,
          answer: ragResult.answer,
          sources: ragResult.sources,
          totalResults: ragResult.sources.length,
          searchParameters: {
            limit: validatedLimit,
            minSimilarity: validatedSimilarity,
            usedLangChain: true,
          },
          metadata: ragResult.metadata,
          message: `Found ${ragResult.sources.length} relevant source${ragResult.sources.length === 1 ? '' : 's'} and generated an AI-powered answer.`,
        };

        return JSON.stringify(response);
      } else {
        console.log('[LangChain SearchKnowledge] Using legacy implementation');
        
        // Use legacy search implementation
        const searchResults = await searchKnowledgeBase(
          query,
          this.context.userId,
          {
            limit: validatedLimit,
            minSimilarity: validatedSimilarity,
            includeMetadata: true,
          },
        );

        console.log(`[LangChain SearchKnowledge] Search completed. Found ${searchResults.length} results`);

        // If no results found
        if (searchResults.length === 0) {
          return JSON.stringify({
            query,
            results: [],
            message: 'No relevant content found in your knowledge base. Try a different search query.',
            totalResults: 0,
          });
        }

        // Format results for the AI
        const formattedResults = searchResults.map((result, index) => ({
          rank: index + 1,
          content: result.content,
          similarity: Math.round(result.similarity * 100) / 100,
          source: {
            document: result.source.documentTitle,
            documentId: result.source.documentId,
            section: `Chunk ${result.source.chunkIndex + 1}`,
          },
          relevanceScore: this.getRelevanceLabel(result.similarity),
        }));

        // Create a summary for the AI to use
        const summary = this.createSearchSummary(query, formattedResults);

        const response = {
          query,
          results: formattedResults,
          summary,
          totalResults: searchResults.length,
          searchParameters: {
            limit: validatedLimit,
            minSimilarity: validatedSimilarity,
            usedLangChain: false,
          },
          message: `Found ${searchResults.length} relevant result${searchResults.length === 1 ? '' : 's'} in your knowledge base.`,
        };

        return JSON.stringify(response);
      }
    } catch (error) {
      console.error('[LangChain SearchKnowledge] Error:', error);

      return JSON.stringify({
        error: 'Failed to search knowledge base',
        query,
        results: [],
        message: 'Sorry, there was an error searching your documents. Please try again.',
      });
    }
  }

  /**
   * Get a human-readable relevance label based on similarity score
   */
  private getRelevanceLabel(similarity: number): string {
    if (similarity >= 0.8) return 'Highly Relevant';
    if (similarity >= 0.65) return 'Very Relevant';
    if (similarity >= 0.5) return 'Relevant';
    if (similarity >= 0.3) return 'Somewhat Relevant';
    return 'Low Relevance';
  }

  /**
   * Create a summary of search results for the AI to use in its response
   */
  private createSearchSummary(query: string, results: any[]): string {
    if (results.length === 0) {
      return `No relevant content found for "${query}" in the user's knowledge base.`;
    }

    const documentTitles = Array.from(
      new Set(results.map((r) => r.source.document)),
    );
    const highRelevanceCount = results.filter((r) => r.similarity >= 0.8).length;

    let summary = `Found ${results.length} relevant result${results.length === 1 ? '' : 's'} for "${query}"`;

    if (documentTitles.length === 1) {
      summary += ` from the document "${documentTitles[0]}"`;
    } else {
      summary += ` across ${documentTitles.length} documents: ${documentTitles.slice(0, 3).join(', ')}${documentTitles.length > 3 ? '...' : ''}`;
    }

    if (highRelevanceCount > 0) {
      summary += `. ${highRelevanceCount} result${highRelevanceCount === 1 ? ' is' : 's are'} highly relevant.`;
    }

    return summary;
  }
}

/**
 * Factory function to create the LangChain search knowledge tool
 */
export function createLangChainSearchKnowledgeTool(context: LangChainToolContext): LangChainSearchKnowledgeTool {
  return new LangChainSearchKnowledgeTool(context);
}