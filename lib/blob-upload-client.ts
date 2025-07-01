/**
 * Client-side blob upload utilities for handling large files
 * This uses Vercel's client-side upload that bypasses serverless function limits entirely
 */

import { upload } from '@vercel/blob/client';

export interface BlobUploadOptions {
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface BlobUploadResult {
  url: string;
  filename: string;
  contentType: string;
  size: number;
}

/**
 * Upload a file using Vercel's client-side blob upload
 * This bypasses serverless function size limits entirely
 */
export async function uploadFileToBlob(
  file: File,
  options: BlobUploadOptions = {}
): Promise<BlobUploadResult> {
  const { onProgress, signal } = options;

  try {
    onProgress?.(5);
    
    console.log(`[Client Upload] Starting client-side upload for file: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
    
    // Upload directly to Vercel Blob using client-side upload
    const blob = await upload(file.name, file, {
      access: 'public',
      handleUploadUrl: '/api/blob/upload-url',
      clientPayload: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        size: file.size,
      }),
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const progress = (progressEvent.loaded / progressEvent.total) * 100;
          onProgress?.(5 + (progress * 0.90)); // Map to 5-95%
        }
      },
    });

    onProgress?.(100);
    
    console.log(`[Client Upload] Upload completed successfully: ${blob.url}`);

    return {
      url: blob.url,
      filename: file.name,
      contentType: file.type,
      size: file.size,
    };

  } catch (error) {
    console.error('Client-side blob upload error:', error);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Upload was cancelled');
      }
      throw error;
    }
    
    throw new Error('Failed to upload file to blob storage');
  }
}

/**
 * Check if a file should use direct blob upload based on size
 */
export function shouldUseDirectBlobUpload(fileSize: number): boolean {
  // Use client-side blob upload for files larger than 4MB to avoid serverless limits
  // This provides a safety margin below Vercel's 4.5MB limit
  const threshold = 4 * 1024 * 1024; // 4MB
  return fileSize > threshold;
}

/**
 * Process a knowledge document that was uploaded to blob storage
 */
export async function processKnowledgeDocumentFromBlob(
  blobUrl: string,
  originalFilename: string,
  options: { signal?: AbortSignal } = {}
): Promise<any> {
  const { signal } = options;

  try {
    const response = await fetch('/api/knowledge/process-blob', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        blobUrl,
        filename: originalFilename,
      }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to process document');
    }

    return await response.json();
  } catch (error) {
    console.error('Document processing error:', error);
    throw error;
  }
}