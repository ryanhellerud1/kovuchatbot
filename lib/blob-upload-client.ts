/**
 * Client-side blob upload utilities for handling large files
 * This creates a simpler upload flow that uses a dedicated endpoint
 */

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
 * Upload a file using a dedicated blob upload endpoint
 * This bypasses the serverless function size limits
 */
export async function uploadFileToBlob(
  file: File,
  options: BlobUploadOptions = {}
): Promise<BlobUploadResult> {
  const { onProgress, signal } = options;

  try {
    onProgress?.(5);
    
    // Create form data for the blob upload
    const formData = new FormData();
    formData.append('file', file);
    formData.append('filename', file.name);
    formData.append('contentType', file.type);
    
    onProgress?.(10);
    
    // Upload to dedicated blob endpoint
    const response = await fetch('/api/blob/upload', {
      method: 'POST',
      body: formData,
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(errorData.error || 'Failed to upload to blob storage');
    }

    onProgress?.(90);
    
    const result = await response.json();
    
    onProgress?.(100);

    return {
      url: result.url,
      filename: result.filename || file.name,
      contentType: file.type,
      size: file.size,
    };

  } catch (error) {
    console.error('Blob upload error:', error);
    
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
  // Use direct blob upload for files larger than 4MB to avoid serverless limits
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