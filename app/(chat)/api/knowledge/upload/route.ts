import { NextResponse } from 'next/server';
import { z } from 'zod';
import { put } from '@vercel/blob';

import { auth } from '@/app/(auth)/auth';
import { processDocument, getFileType, validateFileSize } from '@/lib/rag/document-processor';
import { saveKnowledgeDocument, saveDocumentChunk } from '@/lib/db/queries';
import { generateUUID } from '@/lib/utils';

/**
 * Schema for validating knowledge document uploads
 */
const KnowledgeFileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => validateFileSize(file.size), {
      message: 'File size should be less than 10MB',
    })
    .refine((file) => {
      // Check if file type is supported for RAG processing
      const supportedTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
        'text/plain',
        'text/markdown',
      ];
      return supportedTypes.includes(file.type);
    }, {
      message: 'File type must be PDF, DOCX, TXT, or Markdown',
    }),
});

/**
 * Response schema for successful upload
 */
interface UploadResponse {
  success: true;
  document: {
    id: string;
    title: string;
    fileType: string;
    fileSize: number;
    chunkCount: number;
    fileUrl?: string;
    summary: string;
    firstPageContent: string;
  };
}

/**
 * Response schema for upload errors
 */
interface ErrorResponse {
  success: false;
  error: string;
  details?: string;
}

export async function POST(request: Request): Promise<NextResponse<UploadResponse | ErrorResponse>> {
  const session = await auth();

  if (!session || !session.user?.id) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  if (request.body === null) {
    return NextResponse.json(
      { success: false, error: 'Request body is empty' },
      { status: 400 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as Blob;
    const saveToBlob = formData.get('saveToBlob') === 'true'; // Optional: save original file to blob storage

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file uploaded' },
        { status: 400 }
      );
    }

    // Validate file
    const validatedFile = KnowledgeFileSchema.safeParse({ file });
    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.errors
        .map((error) => error.message)
        .join(', ');

      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 400 }
      );
    }

    // Get filename and detect file type
    const filename = (formData.get('file') as File).name;
    const fileType = getFileType(filename);
    
    if (!fileType) {
      return NextResponse.json(
        { success: false, error: 'Unsupported file type' },
        { status: 400 }
      );
    }

    // Convert file to buffer for processing
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Process document with RAG pipeline
    console.log(`Processing document with RAG pipeline: ${filename}`);
    const processedDocument = await processDocument(fileBuffer, filename, fileType);
    console.log(`Document processed. Chunks: ${processedDocument.chunks.length}`);

    // Optional: Save original file to blob storage
    let fileUrl: string | undefined;
    if (saveToBlob) {
      console.log('Attempting to save original file to blob storage.');
      try {
        const blobResult = await put(`knowledge/${session.user.id}/${filename}`, fileBuffer, {
          access: 'public', // Note: Vercel Blob doesn't support private access in free tier
        });
        fileUrl = blobResult.url;
        console.log('File saved to blob storage.', fileUrl);
      } catch (error) {
        console.warn('Failed to save file to blob storage:', error);
        // Continue without blob storage - not critical for RAG functionality
      }
    }

    // Save knowledge document to database
    console.log('Saving knowledge document metadata to database.');
    const documentId = generateUUID();
    const savedDocument = await saveKnowledgeDocument({
      id: documentId,
      userId: session.user.id,
      title: processedDocument.title,
      content: processedDocument.content,
      fileUrl,
      fileType: processedDocument.fileType,
      fileSize: processedDocument.fileSize,
      metadata: {
        originalFilename: filename,
        processedAt: new Date().toISOString(),
        chunkCount: processedDocument.chunks.length,
        embeddingModel: 'text-embedding-3-small',
      },
    });
    console.log('Knowledge document metadata saved.', savedDocument.id);

    // Save document chunks with embeddings
    console.log(`Saving ${processedDocument.chunks.length} document chunks with embeddings.`);
    const chunkPromises = processedDocument.chunks.map(async (chunk, index) => {
      return saveDocumentChunk({
        documentId: savedDocument.id,
        chunkIndex: index,
        content: chunk.content,
        embedding: processedDocument.embeddings[index],
        metadata: chunk.metadata,
      });
    });

    await Promise.all(chunkPromises);
    console.log('All document chunks saved.');

    console.log(`Successfully processed document: ${filename} with ${processedDocument.chunks.length} chunks`);

    console.log('Server preparing to send success response for document:', savedDocument.title);
    // Return success response
    return NextResponse.json({
      success: true,
      document: {
        id: savedDocument.id,
        title: savedDocument.title,
        fileType: savedDocument.fileType || fileType,
        fileSize: savedDocument.fileSize || 0,
        chunkCount: processedDocument.chunks.length,
        fileUrl: savedDocument.fileUrl || undefined,
        summary: processedDocument.summary,
        firstPageContent: processedDocument.firstPageContent,
      },
    });

  } catch (error) {
    console.error('Error processing knowledge document:', error);
    
    // Provide more specific error messages based on error type
    if (error instanceof Error) {
      if (error.message.includes('Failed to extract text')) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'Failed to extract text from document',
            details: 'The document may be corrupted or password-protected'
          },
          { status: 400 }
        );
      }
      
      if (error.message.includes('No text content found')) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'No text content found in document',
            details: 'The document appears to be empty or contains only images'
          },
          { status: 400 }
        );
      }

      if (error.message.includes('OpenAI')) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'Failed to generate embeddings',
            details: 'There was an issue with the AI processing service'
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to process document',
        details: 'An unexpected error occurred during processing'
      },
      { status: 500 }
    );
  }
}