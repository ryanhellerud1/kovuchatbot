import type { NextRequest } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { getUserKnowledgeDocuments, getUserDocumentChunks } from '@/lib/db/queries';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userId = session.user.id;
    
    // Get user documents
    const documents = await getUserKnowledgeDocuments(userId);
    
    // Get user chunks
    const chunks = await getUserDocumentChunks(userId);
    
    // Format the response for debugging
    const debugInfo = {
      userId,
      userEmail: session.user.email,
      documentsCount: documents.length,
      chunksCount: chunks.length,
      documents: documents.map(doc => ({
        id: doc.id,
        title: doc.title,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        createdAt: doc.createdAt,
      })),
      chunks: chunks.map(chunk => ({
        id: chunk.id,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        chunkIndex: chunk.chunkIndex,
        contentPreview: `${chunk.content.substring(0, 100)}...`,
        hasEmbedding: !!chunk.embedding,
        embeddingLength: Array.isArray(chunk.embedding) ? chunk.embedding.length : 0,
      })),
    };
    
    return Response.json(debugInfo);
    
  } catch (error) {
    console.error('Debug knowledge error:', error);
    return Response.json({ 
      error: 'Failed to debug knowledge base',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}