import { NextRequest } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { getUserDocumentChunks } from '@/lib/db/queries';
import { generateEmbedding } from '@/lib/rag/retriever';
import { cosineSimilarity } from '@/lib/rag/similarity';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { query } = await request.json();
    
    if (!query) {
      return Response.json({ error: 'Query is required' }, { status: 400 });
    }

    const userId = session.user.id;
    
    // Get user chunks
    const chunks = await getUserDocumentChunks(userId);
    
    if (chunks.length === 0) {
      return Response.json({
        error: 'No document chunks found',
        query,
        userId,
        chunksCount: 0
      });
    }
    
    // Generate embedding for the query
    console.log('Generating embedding for query:', query);
    const queryEmbedding = await generateEmbedding(query);
    console.log('Query embedding generated, length:', queryEmbedding.length);
    
    // Calculate similarities for all chunks
    const results = [];
    let validChunks = 0;
    let invalidChunks = 0;
    
    for (const chunk of chunks) {
      if (!chunk.embedding) {
        invalidChunks++;
        continue;
      }
      
      const chunkEmbedding = chunk.embedding as number[] | null;
      if (!Array.isArray(chunkEmbedding)) {
        invalidChunks++;
        continue;
      }
      
      validChunks++;
      const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
      
      results.push({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        chunkIndex: chunk.chunkIndex,
        similarity: Math.round(similarity * 1000) / 1000, // Round to 3 decimal places
        contentPreview: chunk.content.substring(0, 200) + '...',
        embeddingLength: chunkEmbedding.length,
      });
    }
    
    // Sort by similarity
    results.sort((a, b) => b.similarity - a.similarity);
    
    // Get statistics
    const similarities = results.map(r => r.similarity);
    const maxSimilarity = Math.max(...similarities);
    const minSimilarity = Math.min(...similarities);
    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
    
    // Count results above different thresholds
    const above04 = results.filter(r => r.similarity >= 0.4).length;
    const above03 = results.filter(r => r.similarity >= 0.3).length;
    const above02 = results.filter(r => r.similarity >= 0.2).length;
    
    return Response.json({
      query,
      userId,
      totalChunks: chunks.length,
      validChunks,
      invalidChunks,
      queryEmbeddingLength: queryEmbedding.length,
      statistics: {
        maxSimilarity,
        minSimilarity,
        avgSimilarity: Math.round(avgSimilarity * 1000) / 1000,
      },
      thresholdCounts: {
        above04,
        above03,
        above02,
      },
      topResults: results.slice(0, 10), // Top 10 results
      allSimilarities: similarities.slice(0, 20), // First 20 similarities for analysis
    });
    
  } catch (error) {
    console.error('Debug search error:', error);
    return Response.json({ 
      error: 'Failed to debug search',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}