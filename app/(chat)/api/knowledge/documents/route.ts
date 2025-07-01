import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { 
  getUserKnowledgeDocuments, 
  getKnowledgeDocumentById,
  deleteKnowledgeDocument 
} from '@/lib/db/queries';
import { deleteFromBlob } from '@/lib/blob-storage';

/**
 * GET /api/knowledge/documents
 * List all knowledge documents for the authenticated user
 */
export async function GET(request: Request) {
  const session = await auth();

  if (!session || !session.user?.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get('limit') || '50');
    const offset = Number.parseInt(searchParams.get('offset') || '0');

    const documents = await getUserKnowledgeDocuments(session.user.id, limit, offset);

    // Transform documents for client response
    const transformedDocuments = documents.map(doc => ({
      id: doc.id,
      title: doc.title,
      fileType: doc.fileType,
      fileSize: doc.fileSize,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      metadata: doc.metadata,
      hasFileUrl: !!doc.fileUrl,
    }));

    return NextResponse.json({
      documents: transformedDocuments,
      total: transformedDocuments.length,
      limit,
      offset,
    });

  } catch (error) {
    console.error('Error fetching knowledge documents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/knowledge/documents
 * Delete a knowledge document and all its chunks
 */
export async function DELETE(request: Request) {
  const session = await auth();

  if (!session || !session.user?.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('id');

    if (!documentId) {
      return NextResponse.json(
        { error: 'Document ID is required' },
        { status: 400 }
      );
    }

    // Verify document belongs to user before deletion
    const document = await getKnowledgeDocumentById(documentId, session.user.id);
    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Delete file from blob storage if it exists
    if (document.fileUrl) {
      try {
        console.log(`[Delete Document] Deleting file from blob storage: ${document.fileUrl}`);
        await deleteFromBlob(document.fileUrl);
        console.log(`[Delete Document] Successfully deleted file from blob storage`);
      } catch (blobError) {
        console.error('Failed to delete file from blob storage:', blobError);
        // Continue with database deletion even if blob deletion fails
        // This prevents orphaned database records if the blob was already deleted manually
      }
    }

    // Delete document and all associated chunks from database
    await deleteKnowledgeDocument(documentId, session.user.id);

    return NextResponse.json({
      success: true,
      message: 'Document deleted successfully',
      deletedDocument: {
        id: document.id,
        title: document.title,
      },
    });

  } catch (error) {
    console.error('Error deleting knowledge document:', error);
    return NextResponse.json(
      { error: 'Failed to delete document' },
      { status: 500 }
    );
  }
}