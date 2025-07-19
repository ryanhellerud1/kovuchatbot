import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { auth } from '@/app/(auth)/auth';

// Configure route for upload URL generation
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Generate a signed upload URL for client-side blob uploads
 * This allows files to be uploaded directly to Vercel Blob without going through serverless functions
 */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();

  if (!session || !session.user?.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  try {
    const body = (await request.json()) as HandleUploadBody;

    console.log(`[Upload URL] Generating signed URL for client-side upload`);

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Validate the upload request
        console.log(`[Upload URL] Validating upload for: ${pathname}`);

        // Parse the client payload to get file info
        const payload = JSON.parse(clientPayload || '{}');
        const { filename, contentType, size } = payload;

        // Validate file size
        const maxSize = 15 * 1024 * 1024; // 15MB for knowledge documents
        if (size && size > maxSize) {
          throw new Error(
            `File too large. Maximum size is 15MB. Your file is ${(size / 1024 / 1024).toFixed(1)}MB.`,
          );
        }

        // Validate file type for knowledge documents
        const supportedTypes = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
          'text/markdown',
          'application/epub+zip',
        ];

        if (contentType && !supportedTypes.includes(contentType)) {
          throw new Error(
            'Unsupported file type. Please upload PDF, DOCX, TXT, Markdown, or EPUB files.',
          );
        }

        // Generate unique pathname for the user
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const extension = filename
          ? filename.substring(filename.lastIndexOf('.'))
          : '';
        const nameWithoutExt = filename
          ? filename.substring(0, filename.lastIndexOf('.'))
          : 'file';
        const uniqueFilename = `${timestamp}_${randomSuffix}_${nameWithoutExt}${extension}`;

        const finalPathname = `knowledge/${session.user.id}/${uniqueFilename}`;

        console.log(`[Upload URL] Generated pathname: ${finalPathname}`);

        return {
          allowedContentTypes: supportedTypes,
          tokenPayload: JSON.stringify({
            userId: session.user.id,
            originalFilename: filename,
            uploadedAt: new Date().toISOString(),
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // This runs after the upload is completed
        console.log(`[Upload URL] Upload completed: ${blob.url}`);

        // You could add additional processing here if needed
        // For now, we'll handle processing in the separate process-blob endpoint
      },
    });

    console.log(`[Upload URL] Generated upload URL successfully`);

    return Response.json(jsonResponse);
  } catch (error) {
    console.error('Upload URL generation error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate upload URL',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
