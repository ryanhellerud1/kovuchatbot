import { NextRequest } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { searchKnowledge } from '@/lib/ai/tools/search-knowledge';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Test the exact query that's failing
    const testQuery = "key aspects of good data science";
    
    console.log(`[test-search] Testing query: "${testQuery}"`);
    
    // Create the search tool instance
    const searchTool = searchKnowledge({ session });
    
    // Execute the search with different thresholds
    const results = await Promise.all([
      searchTool.execute({ 
        query: testQuery, 
        minSimilarity: 0.4, 
        dynamicThreshold: true,
        limit: 10 
      }),
      searchTool.execute({ 
        query: testQuery, 
        minSimilarity: 0.3, 
        dynamicThreshold: false,
        limit: 10 
      }),
      searchTool.execute({ 
        query: testQuery, 
        minSimilarity: 0.2, 
        dynamicThreshold: false,
        limit: 10 
      }),
    ]);
    
    return Response.json({
      query: testQuery,
      userId: session.user.id,
      userEmail: session.user.email,
      results: {
        'threshold_0.4_dynamic': results[0],
        'threshold_0.3_static': results[1], 
        'threshold_0.2_static': results[2],
      },
      timestamp: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error('Test search error:', error);
    return Response.json({ 
      error: 'Failed to test search',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}