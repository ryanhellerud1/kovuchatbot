import { NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { processDocument, getFileType } from '@/lib/rag/retriever';
import { saveKnowledgeDocument, saveDocumentChunk } from '@/lib/db/queries';
import { generateUUID } from '@/lib/utils';

// Configure route for document processing
export const runtime = 'nodejs';
export const maxDuration = 60;

interface ProcessBlobRequest {
  blobUrl: string;
  filename: string;
}

interface ProcessBlobResponse {
  success: true;
  document: {
    id: string;
    title: string;
    fileType: string;
    fileSize: number;
    chunkCount: number;
    fileUrl: string;
    summary: string;
    firstPageContent: string;
  };
}

interface ProcessBlobError {
  success: false;
  error: string;
  details?: string;
}

export async function POST(request: Request): Promise<NextResponse<ProcessBlobResponse | ProcessBlobError>> {
  console.log('[Process Blob] Starting document processing from blob storage');
  
  const session = await auth();

  if (!session || !session.user?.id) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  // Check environment variables
  if (!process.env.OPENAI_API_KEY) {
    console.error('[Process Blob] OPENAI_API_KEY is not set');
    return NextResponse.json(
      { 
        success: false, 
        error: 'OpenAI API key not configured',
        details: 'The server is missing the required OpenAI API key configuration'
      },
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    const { blobUrl, filename }: ProcessBlobRequest = await request.json();

    if (!blobUrl || !filename) {
      return NextResponse.json(
        { success: false, error: 'Blob URL and filename are required' },
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('[Process Blob] Processing document from blob:', { blobUrl, filename });

    // Get file type
    const fileType = getFileType(filename);
    if (!fileType) {
      return NextResponse.json(
        { success: false, error: 'Unsupported file type' },
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Download file from blob storage
    console.log('[Process Blob] Downloading file from blob storage...');
    const fileResponse = await fetch(blobUrl);
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file from blob storage: ${fileResponse.status}`);
    }

    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
    const fileSize = fileBuffer.length;
    console.log('[Process Blob] File downloaded successfully, size:', fileSize);

    // Process document with LangChain RAG pipeline
    console.log('[Process Blob] Processing document with LangChain RAG pipeline...');
    let processedDocument;
    try {
      processedDocument = await processDocument(fileBuffer, filename, fileType);
      console.log('[Process Blob] Document processed successfully. Chunks:', processedDocument.chunks.length);
    } catch (processingError) {
      console.error('[Process Blob] Error during document processing:', processingError);
      throw processingError;
    }

    // Save knowledge document to database
    console.log('[Process Blob] Saving knowledge document metadata to database...');
    const documentId = generateUUID();
    let savedDocument;
    try {
      savedDocument = await saveKnowledgeDocument({
        id: documentId,
        userId: session.user.id,
        title: processedDocument.title,
        content: processedDocument.content,
        fileUrl: blobUrl, // Store the blob URL
        fileType: processedDocument.fileType,
        fileSize: fileSize,
        metadata: {
          originalFilename: filename,
          processedAt: new Date().toISOString(),
          chunkCount: processedDocument.chunks.length,
          embeddingModel: 'text-embedding-3-small',
          processedWithLangChain: true,
          uploadedToBlob: true,
          blobUrl,
        },
      });
      console.log('[Process Blob] Knowledge document metadata saved successfully:', savedDocument.id);
    } catch (dbError) {
      console.error('[Process Blob] Error saving document metadata to database:', dbError);
      throw new Error(`Failed to save document metadata: ${dbError instanceof Error ? dbError.message : 'Unknown database error'}`);
    }

    // Save document chunks with embeddings
    console.log('[Process Blob] Saving document chunks with embeddings...');
    try {
      const chunkPromises = processedDocument.chunks.map(async (chunk, index) => {
        return saveDocumentChunk({
          documentId: savedDocument.id,
          chunkIndex: index,
          content: chunk.content,
          embedding: processedDocument.embeddings[index],
          metadata: {
            ...chunk.metadata,
            processedWithLangChain: true,
          },
        });
      });

      await Promise.all(chunkPromises);
      console.log('[Process Blob] All document chunks saved successfully.');
    } catch (chunksError) {
      console.error('[Process Blob] Error saving document chunks:', chunksError);
      throw new Error(`Failed to save document chunks: ${chunksError instanceof Error ? chunksError.message : 'Unknown database error'}`);
    }

    console.log('[Process Blob] Document processing completed successfully');

    // Return success response
    return NextResponse.json({
      success: true,
      document: {
        id: savedDocument.id,
        title: savedDocument.title,
        fileType: savedDocument.fileType || fileType,
        fileSize: savedDocument.fileSize || fileSize,
        chunkCount: processedDocument.chunks.length,
        fileUrl: savedDocument.fileUrl || blobUrl,
        summary: processedDocument.summary,
        firstPageContent: processedDocument.firstPageContent,
      },
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Process Blob] Error processing document from blob:', error);
    
    // Provide more specific error messages based on error type
    if (error instanceof Error) {
      if (error.message.includes('Failed to extract text')) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'Failed to extract text from document',
            details: 'The document may be corrupted or password-protected'
          },
          { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
      
      if (error.message.includes('No text content found')) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'No text content found in document',
            details: 'The document appears to be empty or contains only images'
          },
          { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      if (error.message.includes('OpenAI')) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'Failed to generate embeddings',
            details: 'There was an issue with the AI processing service'
          },
          { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    }

    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to process document from blob storage',
        details: error instanceof Error ? error.message : 'An unexpected error occurred during processing'
      },
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}