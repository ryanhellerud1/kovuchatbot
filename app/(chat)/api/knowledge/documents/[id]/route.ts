import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { 
  getKnowledgeDocumentById,
  getDocumentChunks 
} from '@/lib/db/queries';

/**
 * GET /api/knowledge/documents/[id]
 * Get a specific knowledge document with its chunks
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();

  if (!session || !session.user?.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const documentId = params.id;

    if (!documentId) {
      return NextResponse.json(
        { error: 'Document ID is required' },
        { status: 400 }
      );
    }

    // Get document details
    const document = await getKnowledgeDocumentById(documentId, session.user.id);
    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Get URL parameters for chunk options
    const { searchParams } = new URL(request.url);
    const includeChunks = searchParams.get('includeChunks') === 'true';
    const includeEmbeddings = searchParams.get('includeEmbeddings') === 'true';

    let chunks = undefined;
    if (includeChunks) {
      const documentChunks = await getDocumentChunks(documentId);
      
      // Transform chunks for response (optionally exclude embeddings for performance)
      chunks = documentChunks.map(chunk => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        metadata: chunk.chunkMetadata,
        createdAt: chunk.createdAt,
        ...(includeEmbeddings && { 
          embedding: chunk.embedding,
          embeddingDimensions: Array.isArray(chunk.embedding) ? chunk.embedding.length : 0
        }),
      }));
    }

    // Transform document for response
    const responseDocument = {
      id: document.id,
      title: document.title,
      content: document.content,
      fileType: document.fileType,
      fileSize: document.fileSize,
      fileUrl: document.fileUrl,
      metadata: document.metadata,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      ...(chunks && { 
        chunks,
        chunkCount: chunks.length 
      }),
    };

    return NextResponse.json({
      document: responseDocument,
    });

  } catch (error) {
    console.error('Error fetching knowledge document:', error);
    return NextResponse.json(
      { error: 'Failed to fetch document' },
      { status: 500 }
    );
  }
}