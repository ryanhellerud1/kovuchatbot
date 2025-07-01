import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/app/(auth)/auth';
import { getFileType } from '@/lib/rag/retriever';
import { 
  validateKnowledgeDocumentSize,
  shouldUseBlobStorage, 
  uploadToBlob, 
  getBlobFolder,
  formatFileSize,
  BlobStorageError 
} from '@/lib/blob-storage';

// Enhanced file schema that supports both attachments and knowledge documents
const AttachmentFileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 50 * 1024 * 1024, {
      message: 'File size should be less than 50MB',
    })
    .refine((file) => ['image/jpeg', 'image/png'].includes(file.type), {
      message: 'File type should be JPEG or PNG',
    }),
});

const KnowledgeFileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => validateKnowledgeDocumentSize(file.size), {
      message: 'File size should be less than 15MB for knowledge documents',
    })
    .refine((file) => {
      const supportedTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'text/markdown',
      ];
      return supportedTypes.includes(file.type);
    }, {
      message: 'File type must be PDF, DOCX, TXT, or Markdown for knowledge documents',
    }),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (request.body === null) {
    return new Response('Request body is empty', { status: 400 });
  }

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (formDataError) {
      console.error('Error parsing form data:', formDataError);
      return NextResponse.json(
        { 
          error: 'Invalid form data',
          details: 'Failed to parse multipart form data'
        },
        { 
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
    }
    
    const file = formData.get('file') as Blob;
    const uploadType = formData.get('type') as string || 'attachment'; // 'attachment' or 'knowledge'

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // Get filename from formData since Blob doesn't have name property
    const filename = (formData.get('file') as File).name;

    // Determine if this is a knowledge document based on file type or explicit type
    const fileType = getFileType(filename);
    const isKnowledgeDocument = uploadType === 'knowledge' || 
      (uploadType === 'auto' && fileType !== null);

    // Validate file based on upload type
    let validatedFile: { success: boolean; error?: any };
    if (isKnowledgeDocument) {
      validatedFile = KnowledgeFileSchema.safeParse({ file });
      if (!validatedFile.success) {
        const errorMessage = validatedFile.error.errors
          .map((error) => error.message)
          .join(', ');
        return NextResponse.json({ error: errorMessage }, { status: 400 });
      }
    } else {
      validatedFile = AttachmentFileSchema.safeParse({ file });
      if (!validatedFile.success) {
        const errorMessage = validatedFile.error.errors
          .map((error) => error.message)
          .join(', ');
        return NextResponse.json({ error: errorMessage }, { status: 400 });
      }
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // If it's a knowledge document, redirect to knowledge upload endpoint
    if (isKnowledgeDocument) {
      // Forward to knowledge upload endpoint
      const knowledgeFormData = new FormData();
      knowledgeFormData.append('file', new Blob([fileBuffer], { type: file.type }));
      knowledgeFormData.append('saveToBlob', 'true');

      const knowledgeResponse = await fetch(new URL('/api/knowledge/upload', request.url), {
        method: 'POST',
        body: knowledgeFormData,
        headers: {
          // Forward auth headers
          'Cookie': request.headers.get('Cookie') || '',
        },
      });

      const knowledgeData = await knowledgeResponse.json();
      
      if (knowledgeResponse.ok) {
        // Return in format expected by attachment system
        return NextResponse.json({
          url: knowledgeData.document.fileUrl || `/api/knowledge/documents/${knowledgeData.document.id}`,
          pathname: knowledgeData.document.title,
          contentType: file.type,
          size: knowledgeData.document.fileSize,
          knowledgeDocument: true,
          documentId: knowledgeData.document.id,
        });
      } else {
        return NextResponse.json(knowledgeData, { status: knowledgeResponse.status });
      }
    }

    // Handle regular attachment upload
    try {
      console.log(`Uploading attachment (size: ${formatFileSize(file.size)})`);
      
      const blobFolder = getBlobFolder('attachment');
      const data = await uploadToBlob(fileBuffer, filename, blobFolder, {
        access: 'public',
        addRandomSuffix: true,
      });

      // Return data in expected format
      return NextResponse.json({
        url: data.url,
        pathname: data.pathname,
        contentType: file.type,
        size: file.size,
      });
    } catch (error) {
      console.error('Attachment upload error:', error);
      
      // Provide more specific error message for large files
      if (shouldUseBlobStorage(file.size)) {
        return NextResponse.json(
          { 
            error: 'Failed to upload large file to storage',
            details: error instanceof BlobStorageError ? error.message : 'Unknown error'
          }, 
          { status: 500 }
        );
      }
      
      return NextResponse.json({ 
        error: 'Upload failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process request',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        }
      },
    );
  }
}
