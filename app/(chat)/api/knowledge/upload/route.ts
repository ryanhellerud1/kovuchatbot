import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/app/(auth)/auth';
import { processDocument, getFileType } from '@/lib/rag/retriever';
import { saveKnowledgeDocument, saveDocumentChunk } from '@/lib/db/queries';
import { generateUUID } from '@/lib/utils';
import {
  validateKnowledgeDocumentSize,
  shouldUseBlobStorage,
  uploadToBlob,
  getBlobFolder,
  formatFileSize,
  BlobStorageError,
} from '@/lib/blob-storage';

/**
 * Schema for validating knowledge document uploads
 */
const KnowledgeFileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => validateKnowledgeDocumentSize(file.size), {
      message: 'File size should be less than 15MB for knowledge documents',
    })
    .refine(
      (file) => {
        // Check if file type is supported for RAG processing
        const supportedTypes = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
          'text/plain',
          'text/markdown',
          'application/epub+zip', // .epub
        ];
        return supportedTypes.includes(file.type);
      },
      {
        message: 'File type must be PDF, DOCX, TXT, Markdown, or EPUB',
      },
    ),
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

// Configure route for large file uploads
export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds timeout for processing

// Configure body size limit for large file uploads
export const dynamic = 'force-dynamic';
export const preferredRegion = 'auto';

export async function POST(
  request: Request,
): Promise<NextResponse<UploadResponse | ErrorResponse>> {
  console.log('[Knowledge Upload] Starting upload request processing');

  // Check environment variables
  if (!process.env.OPENAI_API_KEY) {
    console.error('[Knowledge Upload] OPENAI_API_KEY is not set');
    return NextResponse.json(
      {
        success: false,
        error: 'OpenAI API key not configured',
        details:
          'The server is missing the required OpenAI API key configuration',
      },
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }

  const session = await auth();

  if (!session || !session.user?.id) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }

  if (request.body === null) {
    return NextResponse.json(
      { success: false, error: 'Request body is empty' },
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }

  try {
    let formData: FormData;
    try {
      console.log('[Knowledge Upload] Parsing form data...');
      formData = await request.formData();
      console.log('[Knowledge Upload] Form data parsed successfully');
    } catch (formDataError) {
      console.error(
        '[Knowledge Upload] Error parsing form data:',
        formDataError,
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid form data',
          details: 'Failed to parse multipart form data',
        },
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }

    const file = formData.get('file') as Blob;
    const saveToBlob = formData.get('saveToBlob') === 'true'; // Optional: save original file to blob storage

    console.log('[Knowledge Upload] File extracted from form data:', {
      hasFile: !!file,
      fileSize: file?.size,
      saveToBlob,
    });

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file uploaded' },
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        },
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
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }

    // Get filename and detect file type
    const filename = (formData.get('file') as File).name;
    const fileType = getFileType(filename);

    console.log(
      `[Knowledge Upload] File: ${filename}, Detected type: ${fileType}`,
    );

    if (!fileType) {
      const extension = filename.toLowerCase().split('.').pop();
      return NextResponse.json(
        {
          success: false,
          error: 'Unsupported file type',
          details: `File extension "${extension}" is not supported. Please upload PDF, DOCX, TXT, Markdown, or EPUB files.`,
        },
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }

    // Convert file to buffer for processing
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Process document with LangChain RAG pipeline
    console.log(
      `[Knowledge Upload] Processing document with LangChain RAG pipeline: ${filename}`,
    );
    let processedDocument;
    try {
      processedDocument = await processDocument(fileBuffer, filename, fileType);
      console.log(
        `[Knowledge Upload] Document processed successfully. Chunks: ${processedDocument.chunks.length}`,
      );
    } catch (processingError) {
      console.error(
        '[Knowledge Upload] Error during document processing:',
        processingError,
      );
      throw processingError; // Re-throw to be caught by outer catch block
    }

    // Determine if we should use blob storage
    const shouldUseBlob = saveToBlob || shouldUseBlobStorage(file.size);

    // Save original file to blob storage for large files or when explicitly requested
    let fileUrl: string | undefined;
    if (shouldUseBlob) {
      console.log(
        `Saving file to blob storage (size: ${formatFileSize(file.size)}).`,
      );
      try {
        const blobFolder = getBlobFolder('knowledge', session.user.id);
        const blobResult = await uploadToBlob(
          fileBuffer,
          filename,
          blobFolder,
          {
            access: 'public',
            addRandomSuffix: true,
          },
        );

        fileUrl = blobResult.url;
        console.log('File saved to blob storage:', fileUrl);
      } catch (error) {
        console.error('Failed to save file to blob storage:', error);

        // For large files, blob storage is critical - fail the upload
        if (shouldUseBlobStorage(file.size)) {
          return NextResponse.json(
            {
              success: false,
              error: 'Failed to save large file to storage',
              details:
                error instanceof BlobStorageError
                  ? error.message
                  : 'Large files require blob storage which is currently unavailable',
            },
            {
              status: 500,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );
        }

        // For smaller files, continue without blob storage
        console.warn('Continuing without blob storage for smaller file');
      }
    }

    // Save knowledge document to database
    console.log(
      '[Knowledge Upload] Saving knowledge document metadata to database.',
    );
    const documentId = generateUUID();
    let savedDocument;
    try {
      savedDocument = await saveKnowledgeDocument({
        id: documentId,
        userId: session.user.id,
        title: processedDocument.title,
        fileUrl,
        fileType: processedDocument.fileType,
        fileSize: processedDocument.fileSize,
        metadata: {
          originalFilename: filename,
          processedAt: new Date().toISOString(),
          chunkCount: processedDocument.chunks.length,
          embeddingModel: 'text-embedding-3-small',
          processedWithLangChain: true,
        },
      });
      console.log(
        '[Knowledge Upload] Knowledge document metadata saved successfully:',
        savedDocument.id,
      );
    } catch (dbError) {
      console.error(
        '[Knowledge Upload] Error saving document metadata to database:',
        dbError,
      );
      throw new Error(
        `Failed to save document metadata: ${dbError instanceof Error ? dbError.message : 'Unknown database error'}`,
      );
    }

    // Save document chunks with embeddings
    console.log(
      `[Knowledge Upload] Saving ${processedDocument.chunks.length} document chunks with embeddings.`,
    );
    try {
      const chunkPromises = processedDocument.chunks.map(
        async (chunk, index) => {
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
        },
      );

      await Promise.all(chunkPromises);
      console.log('[Knowledge Upload] All document chunks saved successfully.');
    } catch (chunksError) {
      console.error(
        '[Knowledge Upload] Error saving document chunks:',
        chunksError,
      );
      throw new Error(
        `Failed to save document chunks: ${chunksError instanceof Error ? chunksError.message : 'Unknown database error'}`,
      );
    }

    console.log(
      `Successfully processed document: ${filename} with ${processedDocument.chunks.length} chunks`,
    );

    console.log(
      'Server preparing to send success response for document:',
      savedDocument.title,
    );
    // Return success response
    return NextResponse.json(
      {
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
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    console.error('Error processing knowledge document:', error);

    // Provide more specific error messages based on error type
    if (error instanceof Error) {
      if (error.message.includes('Failed to extract text')) {
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to extract text from document',
            details: 'The document may be corrupted or password-protected',
          },
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      if (error.message.includes('No text content found')) {
        return NextResponse.json(
          {
            success: false,
            error: 'No text content found in document',
            details: 'The document appears to be empty or contains only images',
          },
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      // EPUB-specific error handling
      if (error.message.includes('Invalid EPUB file')) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid EPUB file format',
            details:
              'The file does not appear to be a valid EPUB format or may be corrupted',
          },
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      if (error.message.includes('EPUB parsing failed')) {
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to parse EPUB file',
            details:
              'The EPUB file structure could not be processed. It may be corrupted or use an unsupported format',
          },
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      if (error.message.includes('OpenAI')) {
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to generate embeddings',
            details: 'There was an issue with the AI processing service',
          },
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process document',
        details:
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred during processing',
      },
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }
}
