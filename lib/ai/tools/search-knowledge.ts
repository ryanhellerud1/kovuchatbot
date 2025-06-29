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
      query: z
        .string()
        .describe(
          "The search query to find relevant content in the user's documents",
        ),
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
    }),
    execute: async ({
      query,
      limit = 5,
      minSimilarity = 0.4,
      dynamicThreshold = true,
    }) => {
      // Ensure user is authenticated
      if (!session?.user?.id) {
        return {
          error: 'User not authenticated',
          results: [],
        };
      }

      try {
        console.log(`[searchKnowledge] Starting search for query: "${query}"`);
        
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

        console.log(`[searchKnowledge] Using similarity threshold: ${validatedSimilarity} (original: ${minSimilarity})`);

        // Search the user's knowledge base
        const searchResults = await searchKnowledgeBase(
          query,
          session.user.id,
          {
            limit: validatedLimit,
            minSimilarity: validatedSimilarity,
            includeMetadata: true,
          },
        );

        console.log(`[searchKnowledge] Search completed. Found ${searchResults.length} results`);

        // If no results found
        if (searchResults.length === 0) {
          // Check if user has any documents at all
          const hasDocuments = await userHasDocuments(session.user.id);

          if (!hasDocuments) {
            return {
              query,
              results: [],
              message:
                'No documents found in your knowledge base. Please upload documents first to enable document search.',
              totalResults: 0,
            };
          } else {
            // Suggest alternative search terms
            const suggestions = await getSearchSuggestions(query);
            let message = `No relevant content found for "${query}" in your uploaded documents. Try a different search query.`;

            if (suggestions.length > 0) {
              message += ` You might try: ${suggestions.slice(0, 3).join(', ')}`;
            }

            return {
              query,
              results: [],
              message,
              totalResults: 0,
              suggestions,
            };
          }
        }

        // Format results for the AI
        const formattedResults = searchResults.map(
          (result: SearchResult, index: number) => ({
            rank: index + 1,
            content: result.content,
            similarity: Math.round(result.similarity * 100) / 100, // Round to 2 decimal places
            source: {
              document: result.source.documentTitle,
              documentId: result.source.documentId,
              section: `Chunk ${result.source.chunkIndex + 1}`,
            },
            relevanceScore: getRelevanceLabel(result.similarity),
          }),
        );

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
          message:
            'Sorry, there was an error searching your documents. Please try again.',
        };
      }
    },
  });

import { getUserDocumentChunks } from '@/lib/db/queries';

/**
 * Check if user has any documents in their knowledge base
 */
async function userHasDocuments(userId: string): Promise<boolean> {
  try {
    const chunks = await getUserDocumentChunks(userId);
    console.log(`[userHasDocuments] User ${userId} has ${chunks.length} document chunks`);
    
    if (chunks.length > 0) {
      const chunksWithEmbeddings = chunks.filter(chunk => chunk.embedding && Array.isArray(chunk.embedding));
      console.log(`[userHasDocuments] ${chunksWithEmbeddings.length} chunks have valid embeddings`);
    }
    
    return chunks.length > 0;
  } catch (error) {
    console.error('Error checking user documents:', error);
    return false;
  }
}

/**
 * Generate search suggestions based on the query
 */
async function getSearchSuggestions(query: string): Promise<string[]> {
  const terms = query.split(/\s+/);
  const suggestions: string[] = [];

  // Basic suggestions
  if (terms.length > 1) {
    suggestions.push(terms.slice(0, -1).join(' ')); // Remove last word
  }

  if (terms.length > 2) {
    suggestions.push(terms.slice(1).join(' ')); // Remove first word
  }

  // Add term variations
  if (terms.length > 0) {
    suggestions.push(terms.join(' AND '));
    suggestions.push(terms[0]);
  }

  return [...new Set(suggestions)]; // Deduplicate
}

/**
 * Get a human-readable relevance label based on similarity score
 */
function getRelevanceLabel(similarity: number): string {
  if (similarity >= 0.8) return 'Highly Relevant';
  if (similarity >= 0.65) return 'Very Relevant';
  if (similarity >= 0.5) return 'Relevant';
  if (similarity >= 0.3) return 'Somewhat Relevant';
  return 'Low Relevance';
}

/**
 * Create a summary of search results for the AI to use in its response
 */
function createSearchSummary(query: string, results: any[]): string {
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
