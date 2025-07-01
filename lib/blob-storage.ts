import { put, del, head } from '@vercel/blob';

/**
 * Blob storage configuration and utilities for handling large files
 */

// File size thresholds
export const BLOB_STORAGE_THRESHOLD = 4.5 * 1024 * 1024; // 4.5MB - original threshold
export const SERVERLESS_LIMIT = 4.5 * 1024 * 1024; // 4.5MB - hard Vercel serverless limit
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024; // 50MB for attachments
export const MAX_KNOWLEDGE_DOCUMENT_SIZE = 15 * 1024 * 1024; // 15MB for knowledge documents

/**
 * Check if a file should use blob storage based on its size
 */
export function shouldUseBlobStorage(fileSize: number): boolean {
  return fileSize > BLOB_STORAGE_THRESHOLD;
}

/**
 * Validate file size against maximum limits
 */
export function validateFileSize(fileSize: number, maxSize: number = MAX_FILE_SIZE): boolean {
  return fileSize <= maxSize;
}

/**
 * Validate knowledge document file size (15MB limit)
 */
export function validateKnowledgeDocumentSize(fileSize: number): boolean {
  return fileSize <= MAX_KNOWLEDGE_DOCUMENT_SIZE;
}

/**
 * Generate a unique filename for blob storage
 */
export function generateUniqueFilename(originalFilename: string): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const extension = originalFilename.substring(originalFilename.lastIndexOf('.'));
  const nameWithoutExt = originalFilename.substring(0, originalFilename.lastIndexOf('.'));
  
  return `${timestamp}_${randomSuffix}_${nameWithoutExt}${extension}`;
}

/**
 * Upload a file to blob storage with proper error handling
 */
export async function uploadToBlob(
  buffer: Buffer,
  filename: string,
  folder = 'uploads',
  options: {
    access?: 'public';
    addRandomSuffix?: boolean;
  } = {}
): Promise<{ url: string; pathname: string }> {
  const { access = 'public', addRandomSuffix = true } = options;
  
  try {
    const finalFilename = addRandomSuffix ? generateUniqueFilename(filename) : filename;
    const blobPath = `${folder}/${finalFilename}`;
    
    const result = await put(blobPath, buffer, {
      access,
      addRandomSuffix: false, // We handle uniqueness ourselves
    });
    
    return {
      url: result.url,
      pathname: finalFilename,
    };
  } catch (error) {
    console.error('Blob storage upload error:', error);
    throw new Error(`Failed to upload file to blob storage: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Delete a file from blob storage
 */
export async function deleteFromBlob(url: string): Promise<void> {
  try {
    await del(url);
  } catch (error) {
    console.error('Blob storage deletion error:', error);
    throw new Error(`Failed to delete file from blob storage: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Check if a file exists in blob storage
 */
export async function checkBlobExists(url: string): Promise<boolean> {
  try {
    await head(url);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get file info from blob storage
 */
export async function getBlobInfo(url: string): Promise<{
  size: number;
  uploadedAt: Date;
  contentType?: string;
} | null> {
  try {
    const info = await head(url);
    return {
      size: info.size,
      uploadedAt: info.uploadedAt,
      contentType: info.contentType,
    };
  } catch (error) {
    console.error('Failed to get blob info:', error);
    return null;
  }
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Get the appropriate folder for different file types
 */
export function getBlobFolder(fileType: 'attachment' | 'knowledge' | 'artifact', userId?: string): string {
  switch (fileType) {
    case 'attachment':
      return 'attachments';
    case 'knowledge':
      return userId ? `knowledge/${userId}` : 'knowledge';
    case 'artifact':
      return userId ? `artifacts/${userId}` : 'artifacts';
    default:
      return 'uploads';
  }
}

/**
 * Blob storage error types
 */
export class BlobStorageError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'BlobStorageError';
  }
}

export class FileSizeError extends Error {
  constructor(message: string, public readonly fileSize: number, public readonly maxSize: number) {
    super(message);
    this.name = 'FileSizeError';
  }
}