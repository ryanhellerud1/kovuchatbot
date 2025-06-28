import { tool } from 'ai';
import { z } from 'zod';
import { Session } from 'next-auth';
import { searchKnowledgeBase, SearchResult } from '@/lib/rag/retriever';

interface SearchKnowledgeProps {
  session: Session;
}

/**
 * AI tool for searching through user's personal knowledge base
 * Allows the chatbot to find relevant information from uploaded documents
 */
export const searchKnowledge = ({ session }: SearchKnowledgeProps) =>
  tool({
    description: `Search through the user's personal knowledge base of uploaded documents. 
    Use this tool when the user asks questions about their documents, notes, or any content they've uploaded.
    Examples: "What did I learn about React?", "Find information about my project proposal", "Summarize my research notes"`,
    parameters: z.object({
      query: z.string().describe('The search query to find relevant content in the user\'s documents'),
      limit: z.number().optional().default(5).describe('Maximum number of results to return (1-10)'),
      minSimilarity: z.number().optional().default(0.4).describe('Minimum similarity threshold (0.0-1.0)'),
    }),
    execute: async ({ query, limit = 5, minSimilarity = 0.4 }) => {
      // Ensure user is authenticated
      if (!session?.user?.id) {
        return {
          error: 'User not authenticated',
          results: [],
        };
      }

      try {
        // Validate parameters
        const validatedLimit = Math.min(Math.max(limit, 1), 10);
        const validatedSimilarity = Math.min(Math.max(minSimilarity, 0.0), 1.0);

        // Search the user's knowledge base
        const searchResults = await searchKnowledgeBase(
          query,
          session.user.id,
          {
            limit: validatedLimit,
            minSimilarity: validatedSimilarity,
            includeMetadata: true,
          }
        );

        // If no results found
        if (searchResults.length === 0) {
          return {
            query,
            results: [],
            message: 'No relevant content found in your uploaded documents. You may need to upload documents first or try a different search query.',
            totalResults: 0,
          };
        }

        // Format results for the AI
        const formattedResults = searchResults.map((result: SearchResult, index: number) => ({
          rank: index + 1,
          content: result.content,
          similarity: Math.round(result.similarity * 100) / 100, // Round to 2 decimal places
          source: {
            document: result.source.documentTitle,
            documentId: result.source.documentId,
            section: `Chunk ${result.source.chunkIndex + 1}`,
          },
          relevanceScore: getRelevanceLabel(result.similarity),
        }));

        // Create a summary for the AI to use
        const summary = createSearchSummary(query, formattedResults);

        return {
          query,
          results: formattedResults,
          summary,
          totalResults: searchResults.length,
          searchParameters: {
            limit: validatedLimit,
            minSimilarity: validatedSimilarity,
          },
          message: `Found ${searchResults.length} relevant result${searchResults.length === 1 ? '' : 's'} in your knowledge base.`,
        };

      } catch (error) {
        console.error('Error in searchKnowledge tool:', error);
        
        return {
          error: 'Failed to search knowledge base',
          query,
          results: [],
          message: 'Sorry, there was an error searching your documents. Please try again.',
        };
      }
    },
  });

/**
 * Get a human-readable relevance label based on similarity score
 */
function getRelevanceLabel(similarity: number): string {
  if (similarity >= 0.9) return 'Highly Relevant';
  if (similarity >= 0.8) return 'Very Relevant';
  if (similarity >= 0.7) return 'Relevant';
  if (similarity >= 0.6) return 'Somewhat Relevant';
  return 'Low Relevance';
}

/**
 * Create a summary of search results for the AI to use in its response
 */
function createSearchSummary(query: string, results: any[]): string {
  if (results.length === 0) {
    return `No relevant content found for "${query}" in the user's knowledge base.`;
  }

  const documentTitles = Array.from(new Set(results.map(r => r.source.document)));
  const highRelevanceCount = results.filter(r => r.similarity >= 0.8).length;
  
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