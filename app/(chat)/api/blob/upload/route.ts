import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { auth } from '@/app/(auth)/auth';

// Configure route for blob uploads
export const runtime = 'nodejs';
export const maxDuration = 60;

// Configure body size limit for large file uploads
export const dynamic = 'force-dynamic';
export const preferredRegion = 'auto';

/**
 * Direct blob upload endpoint that handles file uploads to Vercel Blob
 * This bypasses the serverless function size limits for large files
 */
export async function POST(request: Request) {
  const session = await auth();

  if (!session || !session.user?.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const filename = formData.get('filename') as string || file?.name;
    const contentType = formData.get('contentType') as string || file?.type;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Validate file size
    const maxSize = 15 * 1024 * 1024; // 15MB for knowledge documents
    if (file.size > maxSize) {
      return NextResponse.json(
        { 
          error: 'File too large',
          details: `Maximum file size is 15MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB.`
        },
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const extension = filename.substring(filename.lastIndexOf('.'));
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
    const uniqueFilename = `${timestamp}_${randomSuffix}_${nameWithoutExt}${extension}`;

    // Create blob path
    const blobPath = `knowledge/${session.user.id}/${uniqueFilename}`;

    console.log(`[Blob Upload] Uploading file to blob storage: ${blobPath}`);

    // Upload to Vercel Blob
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const blob = await put(blobPath, fileBuffer, {
      access: 'public',
      contentType: contentType || 'application/octet-stream',
    });

    console.log(`[Blob Upload] File uploaded successfully: ${blob.url}`);

    return NextResponse.json({
      url: blob.url,
      filename: uniqueFilename,
      originalFilename: filename,
      contentType: contentType,
      size: file.size,
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Blob upload error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to upload to blob storage',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

