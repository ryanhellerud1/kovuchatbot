import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { searchKnowledgeBase } from '@/lib/rag/retriever';
import { getUserDocumentChunks } from '@/lib/db/queries';
import { generateEmbedding } from '@/lib/rag/retriever';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query') || 'test query';
    const limit = Number.parseInt(searchParams.get('limit') || '8');
    const minSimilarity = Number.parseFloat(searchParams.get('minSimilarity') || '0.25');

    console.log(`[DEBUG] Starting detailed search analysis for query: "${query}"`);

    // Step 1: Check user's document count
    const userChunks = await getUserDocumentChunks(session.user.id);
    const chunksWithEmbeddings = userChunks.filter(chunk => 
      chunk.embedding && Array.isArray(chunk.embedding) && chunk.embedding.length > 0
    );

    console.log(`[DEBUG] User has ${userChunks.length} total chunks, ${chunksWithEmbeddings.length} with embeddings`);

    // Step 2: Analyze query characteristics
    const queryTokens = query.split(/\s+/).length;
    const hasSpecificTerms = /\b(what|how|why|when|where|who|which)\b/i.test(query);
    const hasQuotes = query.includes('"') || query.includes('"') || query.includes('"');

    // Step 3: Calculate dynamic threshold (same logic as search tool)
    let calculatedThreshold = minSimilarity;
    
    if (queryTokens < 3) {
      calculatedThreshold = Math.max(0.15, calculatedThreshold - 0.25);
    } else if (queryTokens < 5) {
      calculatedThreshold = Math.max(0.18, calculatedThreshold - 0.2);
    } else if (queryTokens < 8) {
      calculatedThreshold = Math.max(0.2, calculatedThreshold - 0.15);
    } else {
      calculatedThreshold = Math.min(0.4, calculatedThreshold + 0.05);
    }
    
    if (hasSpecificTerms) {
      calculatedThreshold = Math.max(0.15, calculatedThreshold - 0.08);
    }
    
    if (hasQuotes) {
      calculatedThreshold = Math.max(0.15, calculatedThreshold - 0.12);
    }

    // Step 4: Generate query embedding for manual similarity calculation
    let queryEmbedding: number[] = [];
    try {
      queryEmbedding = await generateEmbedding(query);
      console.log(`[DEBUG] Generated query embedding with ${queryEmbedding.length} dimensions`);
    } catch (error) {
      console.error('[DEBUG] Failed to generate query embedding:', error);
    }

    // Step 5: Perform the actual search
    const searchResults = await searchKnowledgeBase(query, session.user.id, {
      limit,
      minSimilarity: calculatedThreshold,
      includeMetadata: true,
    });

    // Step 6: Get document titles for context
    const documentTitles = Array.from(new Set(userChunks.map(chunk => chunk.documentTitle).filter(Boolean)));

    // Step 7: Calculate manual similarities for top chunks (for verification)
    const manualSimilarities: Array<{
      chunkIndex: number;
      content: string;
      similarity: number;
      documentTitle: string;
    }> = [];

    if (queryEmbedding.length > 0) {
      // Simple cosine similarity for debugging (pgvector handles the real similarity search)
      function cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;
        
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let i = 0; i < a.length; i++) {
          dotProduct += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }
        
        const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
        return magnitude === 0 ? 0 : dotProduct / magnitude;
      }
      
      for (const chunk of chunksWithEmbeddings.slice(0, 20)) { // Check first 20 chunks
        if (chunk.embedding && Array.isArray(chunk.embedding)) {
          // Use simple cosine similarity for debugging
          const similarity = cosineSimilarity(queryEmbedding, chunk.embedding as number[]);
          
          manualSimilarities.push({
            chunkIndex: chunk.chunkIndex,
            content: `${chunk.content.substring(0, 200)}...`,
            similarity: Math.round(similarity * 1000) / 1000,
            documentTitle: chunk.documentTitle || 'Unknown',
          });
        }
      }
      
      // Sort by similarity
      manualSimilarities.sort((a, b) => b.similarity - a.similarity);
    }

    const debugInfo = {
      environment: process.env.NODE_ENV || 'unknown',
      timestamp: new Date().toISOString(),
      query: {
        original: query,
        tokens: queryTokens,
        hasQuestionWords: hasSpecificTerms,
        hasQuotes: hasQuotes,
      },
      thresholds: {
        original: minSimilarity,
        calculated: Math.round(calculatedThreshold * 1000) / 1000,
        adjustments: {
          queryLength: queryTokens < 3 ? -0.25 : queryTokens < 5 ? -0.2 : queryTokens < 8 ? -0.15 : +0.05,
          questionWords: hasSpecificTerms ? -0.08 : 0,
          quotes: hasQuotes ? -0.12 : 0,
        },
      },
      database: {
        totalChunks: userChunks.length,
        chunksWithEmbeddings: chunksWithEmbeddings.length,
        documentTitles: documentTitles,
        embeddingDimensions: chunksWithEmbeddings.length > 0 && chunksWithEmbeddings[0].embedding 
          ? (chunksWithEmbeddings[0].embedding as number[]).length 
          : 0,
      },
      searchResults: {
        count: searchResults.length,
        similarities: searchResults.map(r => Math.round(r.similarity * 1000) / 1000),
        documents: Array.from(new Set(searchResults.map(r => r.source.documentTitle))),
        topResult: searchResults.length > 0 ? {
          similarity: Math.round(searchResults[0].similarity * 1000) / 1000,
          content: `${searchResults[0].content.substring(0, 200)}...`,
          document: searchResults[0].source.documentTitle,
        } : null,
      },
      manualVerification: {
        topSimilarities: manualSimilarities.slice(0, 10),
        aboveThreshold: manualSimilarities.filter(s => s.similarity >= calculatedThreshold).length,
      },
      apiKeys: {
        openaiConfigured: !!process.env.OPENAI_API_KEY,
        openrouterConfigured: !!process.env.OPENROUTER_API_KEY,
      },
    };

    return NextResponse.json(debugInfo);

  } catch (error) {
    console.error('[DEBUG] Error in detailed search debug:', error);
    return NextResponse.json({ 
      error: 'Debug search failed', 
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}