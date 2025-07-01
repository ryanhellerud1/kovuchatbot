import { tool } from 'ai';
import { z } from 'zod';
import type { Session } from 'next-auth';
import { searchKnowledgeBase, type SearchResult } from '@/lib/rag/retriever';
import { getSearchResultTokenStats, formatTokenStats, countTokens } from '@/lib/utils/token-counter';

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
        .default(25)
        .describe('Maximum number of results to return (1-25)'),
      minSimilarity: z
        .number()
        .optional()
        .default(0.22)
        .describe('Minimum similarity threshold (0.0-1.0)'),
      dynamicThreshold: z
        .boolean()
        .optional()
        .default(true)
        .describe('Automatically adjust threshold based on query length'),
    }),
    execute: async ({
      query,
      limit = 25,
      minSimilarity = 0.22,
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
        const validatedLimit = Math.min(Math.max(limit, 1), 25);
        let validatedSimilarity = Math.min(Math.max(minSimilarity, 0.0), 1.0);

        // Adjust threshold dynamically based on query characteristics
        if (dynamicThreshold) {
          const queryTokens = query.split(/\s+/).length;
          const hasSpecificTerms = /\b(what|how|why|when|where|who|which)\b/i.test(query);
          const hasQuotes = query.includes('"') || query.includes('"') || query.includes('"');
          
          // Balanced threshold adjustment with more context budget available
          if (queryTokens < 3) {
            // Broader search for short queries
            validatedSimilarity = Math.max(0.18, validatedSimilarity - 0.15);
          } else if (queryTokens < 5) {
            // Slightly broader search for short-medium queries
            validatedSimilarity = Math.max(0.2, validatedSimilarity - 0.1);
          } else if (queryTokens < 8) {
            // Moderate adjustment for medium queries
            validatedSimilarity = Math.max(0.22, validatedSimilarity - 0.05);
          } else {
            // Keep threshold higher for very long queries
            validatedSimilarity = Math.min(0.4, validatedSimilarity + 0.05);
          }
          
          // Balanced adjustments based on query characteristics
          if (hasSpecificTerms) {
            // Questions need broader search
            validatedSimilarity = Math.max(0.18, validatedSimilarity - 0.05);
          }
          
          if (hasQuotes) {
            // Quoted searches indicate user wants exact matches
            validatedSimilarity = Math.max(0.16, validatedSimilarity - 0.07);
          }
        }

        // Remove the forced low threshold that was causing too many results
        // Keep the calculated threshold to maintain quality
        
        console.log(`[searchKnowledge] Using similarity threshold: ${validatedSimilarity} (original: ${minSimilarity})`);

        // Check database health before searching
        const { performDatabaseHealthCheck } = await import('@/lib/db/health-check');
        const healthCheck = await performDatabaseHealthCheck();
        
        if (!healthCheck.isHealthy) {
          console.error('[searchKnowledge] Database health check failed:', healthCheck.error);
          throw new Error('Database connection is not healthy. Please try again later.');
        }

        // Search the user's knowledge base using LangChain
        const searchResults = await searchKnowledgeBase(query, session.user.id, {
          limit: validatedLimit,
          minSimilarity: validatedSimilarity,
          includeMetadata: true,
        });

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

        // Format results for the AI with enhanced detail and content truncation
        const formattedResults = searchResults.map(
          (result: SearchResult, index: number) => {
            // Truncate very long content to prevent context overflow
            const maxContentLength = 2400; // Allow longer chunks since we have more context budget
            const truncatedContent = result.content.length > maxContentLength 
              ? `${result.content.substring(0, maxContentLength)}...` 
              : result.content;
            
            return {
              rank: index + 1,
              content: truncatedContent,
              similarity: Math.round(result.similarity * 100) / 100, // Round to 2 decimal places
              source: {
                document: result.source.documentTitle,
                documentId: result.source.documentId,
                section: `Chunk ${result.source.chunkIndex + 1}`,
              },
              relevanceScore: getRelevanceLabel(result.similarity),
              keywordBoost: result.keywordBoost ? Math.round(result.keywordBoost * 100) / 100 : undefined,
              contentLength: truncatedContent.length,
              originalLength: result.content.length,
              // Add preview of content for better context
              preview: truncatedContent.length > 200 ? `${truncatedContent.substring(0, 200)}...` : truncatedContent,
            };
          }
        );

        // Calculate token usage for the formatted results
        const initialTokenStats = getSearchResultTokenStats(formattedResults);
        console.log(`[searchKnowledge] Initial results: ${formatTokenStats(initialTokenStats)}`);

        // Check total content length and further limit if necessary
        let finalResults = formattedResults;
        const totalContentLength = formattedResults.reduce((sum, result) => sum + result.contentLength, 0);
        const maxTotalContent = 48000; // Allow more content since context limit is ~15k tokens
        const maxTotalTokens = 12000; // Target token limit for search results
        
        // Check both character and token limits
        const needsLimiting = totalContentLength > maxTotalContent || initialTokenStats.totalTokens > maxTotalTokens;
        
        if (needsLimiting) {
          console.log(`[searchKnowledge] Content exceeds limits - chars: ${totalContentLength}/${maxTotalContent}, tokens: ${initialTokenStats.totalTokens}/${maxTotalTokens}`);
          let currentLength = 0;
          let currentTokens = 0;
          finalResults = [];
          
          for (const result of formattedResults) {
            const resultTokens = countTokens(result.content);
            if (currentLength + result.contentLength <= maxTotalContent && 
                currentTokens + resultTokens <= maxTotalTokens) {
              finalResults.push(result);
              currentLength += result.contentLength;
              currentTokens += resultTokens;
            } else {
              break;
            }
          }
          
          console.log(`[searchKnowledge] Limited to ${finalResults.length} results: ${currentLength} chars, ${currentTokens} tokens`);
        }

        // Calculate final token statistics
        const finalTokenStats = getSearchResultTokenStats(finalResults);
        console.log(`[searchKnowledge] Final results: ${formatTokenStats(finalTokenStats)}`);
        
        // Log token efficiency
        const tokenEfficiency = finalTokenStats.totalTokens > 0 ?
          Math.round((finalTokenStats.totalTokens / maxTotalTokens) * 100) : 0; // % of token budget used
        console.log(`[searchKnowledge] Token budget utilization: ${tokenEfficiency}% (${finalTokenStats.totalTokens}/${maxTotalTokens} tokens)`);

        // Create a summary for the AI to use
        const summary = createSearchSummary(query, finalResults);

        return {
          query,
          results: finalResults,
          summary,
          totalResults: searchResults.length,
          actualResults: finalResults.length,
          searchParameters: {
            limit: validatedLimit,
            minSimilarity: validatedSimilarity,
          },
          contentStats: {
            totalContentLength: finalResults.reduce((sum, result) => sum + result.contentLength, 0),
            totalTokens: finalTokenStats.totalTokens,
            averageTokensPerResult: finalTokenStats.averageTokensPerResult,
            tokenToCharRatio: finalTokenStats.tokenToCharRatio,
            tokenBudgetUsed: tokenEfficiency,
            truncatedResults: finalResults.filter(r => r.originalLength > r.contentLength).length,
          },
          message: `Found ${finalResults.length} relevant result${finalResults.length === 1 ? '' : 's'} in your knowledge base${finalResults.length < searchResults.length ? ` (limited from ${searchResults.length} to prevent context overflow)` : ''}. Using ${finalTokenStats.totalTokens} tokens (${tokenEfficiency}% of budget).`,
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
  if (similarity >= 0.75) return 'Highly Relevant';
  if (similarity >= 0.6) return 'Very Relevant';
  if (similarity >= 0.45) return 'Relevant';
  if (similarity >= 0.3) return 'Somewhat Relevant';
  if (similarity >= 0.2) return 'Potentially Relevant';
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
  const highRelevanceCount = results.filter((r) => r.similarity >= 0.6).length;
  const veryRelevantCount = results.filter((r) => r.similarity >= 0.45).length;

  let summary = `Found ${results.length} relevant result${results.length === 1 ? '' : 's'} for "${query}"`;

  if (documentTitles.length === 1) {
    summary += ` from the document "${documentTitles[0]}"`;
  } else {
    summary += ` across ${documentTitles.length} documents: ${documentTitles.slice(0, 3).join(', ')}${documentTitles.length > 3 ? '...' : ''}`;
  }

  if (highRelevanceCount > 0) {
    summary += `. ${highRelevanceCount} result${highRelevanceCount === 1 ? ' is' : 's are'} highly relevant`;
    if (veryRelevantCount > highRelevanceCount) {
      summary += ` and ${veryRelevantCount - highRelevanceCount} additional result${veryRelevantCount - highRelevanceCount === 1 ? ' is' : 's are'} very relevant`;
    }
    summary += '.';
  } else if (veryRelevantCount > 0) {
    summary += `. ${veryRelevantCount} result${veryRelevantCount === 1 ? ' is' : 's are'} very relevant.`;
  }

  return summary;
}
