import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/app/(auth)/auth';
import { getFileType, validateFileSize } from '@/lib/rag/document-processor';

// Enhanced file schema that supports both attachments and knowledge documents
const AttachmentFileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 5 * 1024 * 1024, {
      message: 'File size should be less than 5MB',
    })
    .refine((file) => ['image/jpeg', 'image/png'].includes(file.type), {
      message: 'File type should be JPEG or PNG',
    }),
});

const KnowledgeFileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => validateFileSize(file.size), {
      message: 'File size should be less than 10MB',
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
    const formData = await request.formData();
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
    let validatedFile;
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

    const fileBuffer = await file.arrayBuffer();

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
      const data = await put(`attachments/${filename}`, fileBuffer, {
        access: 'public',
      });

      return NextResponse.json(data);
    } catch (error) {
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 },
    );
  }
}
