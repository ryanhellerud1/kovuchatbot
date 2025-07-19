import { test, expect } from '@playwright/test';
import {
  parseEPUBBuffer,
  parseEPUBWithMetadata,
  isValidEPUBBuffer,
} from '@/lib/rag/epub-parser';
import { processDocument } from '@/lib/rag/retriever';
import { processDocumentWithLangChain } from '@/lib/rag/langchain-document-processor';
import { createUser, deleteUser } from '../helpers';
import { db, dbClient } from '@/lib/db/client';
import { knowledgeDocuments, documentChunks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test.describe('EPUB Processing', () => {
  let userId: string;
  let testEpubBuffer: Buffer;
  let documentId: string;

  test.beforeAll(async () => {
    const user = await createUser();
    userId = user.id;

    // Create a minimal test EPUB buffer (ZIP with basic EPUB structure)
    // In a real test, you would load an actual EPUB file
    testEpubBuffer = createTestEpubBuffer();
  });

  test.afterAll(async () => {
    // Clean up test data
    if (documentId) {
      await db
        .delete(documentChunks)
        .where(eq(documentChunks.documentId, documentId));
      await db
        .delete(knowledgeDocuments)
        .where(eq(knowledgeDocuments.id, documentId));
    }
    await deleteUser(userId);
    await dbClient.end();
  });

  test.describe('EPUB Parser', () => {
    test('should validate EPUB buffer correctly', async () => {
      // Test valid EPUB buffer (starts with ZIP signature)
      expect(isValidEPUBBuffer(testEpubBuffer)).toBe(true);

      // Test invalid buffer
      const invalidBuffer = Buffer.from('not an epub file');
      expect(isValidEPUBBuffer(invalidBuffer)).toBe(false);

      // Test empty buffer
      const emptyBuffer = Buffer.alloc(0);
      expect(isValidEPUBBuffer(emptyBuffer)).toBe(false);
    });

    test('should handle invalid EPUB files gracefully', async () => {
      const invalidBuffer = Buffer.from('not an epub file');

      await expect(
        parseEPUBBuffer(invalidBuffer, 'invalid.epub'),
      ).rejects.toThrow('Invalid EPUB file - missing ZIP signature');
    });

    test('should handle empty buffers', async () => {
      const emptyBuffer = Buffer.alloc(0);

      await expect(parseEPUBBuffer(emptyBuffer, 'empty.epub')).rejects.toThrow(
        'Empty buffer provided',
      );
    });

    test('should handle non-buffer input', async () => {
      await expect(parseEPUBBuffer(null as any, 'test.epub')).rejects.toThrow(
        'Invalid buffer provided',
      );
    });
  });

  test.describe('EPUB Document Processing', () => {
    test('should process EPUB through legacy pipeline', async () => {
      // Skip if we don't have a real EPUB file for testing
      test.skip(
        !testEpubBuffer || testEpubBuffer.length < 100,
        'No valid test EPUB available',
      );

      const result = await processDocument(
        testEpubBuffer,
        'test-book.epub',
        'epub',
      );

      expect(result).toBeDefined();
      expect(result.title).toBe('test-book');
      expect(result.fileType).toBe('epub');
      expect(result.content).toBeDefined();
      expect(result.chunks).toBeDefined();
      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.embeddings).toBeDefined();
      expect(result.embeddings.length).toBe(result.chunks.length);
      expect(result.summary).toBeDefined();
      expect(result.firstPageContent).toBeDefined();
    });

    test('should process EPUB through LangChain pipeline', async () => {
      // Skip if we don't have a real EPUB file for testing
      test.skip(
        !testEpubBuffer || testEpubBuffer.length < 100,
        'No valid test EPUB available',
      );

      const result = await processDocumentWithLangChain(
        testEpubBuffer,
        'test-book.epub',
        'epub',
      );

      expect(result).toBeDefined();
      expect(result.title).toBe('test-book');
      expect(result.fileType).toBe('epub');
      expect(result.content).toBeDefined();
      expect(result.documents).toBeDefined();
      expect(result.documents.length).toBeGreaterThan(0);
      expect(result.embeddings).toBeDefined();
      expect(result.embeddings.length).toBe(result.documents.length);
      expect(result.summary).toBeDefined();

      // Check for EPUB-specific metadata
      const firstDoc = result.documents[0];
      expect(firstDoc.metadata.fileType).toBe('epub');
    });

    test('should preserve EPUB metadata in processing', async () => {
      // Skip if we don't have a real EPUB file for testing
      test.skip(
        !testEpubBuffer || testEpubBuffer.length < 100,
        'No valid test EPUB available',
      );

      const result = await parseEPUBWithMetadata(
        testEpubBuffer,
        'test-book.epub',
      );

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.chapters).toBeDefined();

      // Check metadata structure
      expect(result.metadata.title).toBeDefined();
      expect(result.metadata.totalChapters).toBeDefined();
      expect(result.metadata.totalChapters).toBe(result.chapters.length);

      // Check chapter structure
      if (result.chapters.length > 0) {
        const firstChapter = result.chapters[0];
        expect(firstChapter.id).toBeDefined();
        expect(firstChapter.title).toBeDefined();
        expect(firstChapter.content).toBeDefined();
        expect(firstChapter.order).toBeDefined();
        expect(firstChapter.wordCount).toBeGreaterThan(0);
      }
    });
  });

  test.describe('EPUB Error Handling', () => {
    test('should handle corrupted EPUB files', async () => {
      // Create a buffer that looks like ZIP but isn't valid EPUB
      const corruptedBuffer = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]), // ZIP signature
        Buffer.from('corrupted data that is not a valid EPUB structure'),
      ]);

      await expect(
        parseEPUBBuffer(corruptedBuffer, 'corrupted.epub'),
      ).rejects.toThrow();
    });

    test('should provide meaningful error messages', async () => {
      const invalidBuffer = Buffer.from('definitely not an epub');

      try {
        await parseEPUBBuffer(invalidBuffer, 'test.epub');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Invalid EPUB file');
      }
    });
  });

  test.describe('EPUB Integration', () => {
    test('should work with existing file type validation', async () => {
      const { getFileType } = await import('@/lib/rag/retriever');

      expect(getFileType('book.epub')).toBe('epub');
      expect(getFileType('book.EPUB')).toBe('epub');
      expect(getFileType('book.pdf')).toBe('pdf');
      expect(getFileType('book.txt')).toBe('txt');
    });

    test('should work with LangChain file type validation', async () => {
      const { validateLangChainFileType } = await import(
        '@/lib/rag/langchain-document-processor'
      );

      expect(validateLangChainFileType('book.epub')).toBe('epub');
      expect(validateLangChainFileType('book.EPUB')).toBe('epub');
      expect(validateLangChainFileType('book.pdf')).toBe('pdf');
      expect(validateLangChainFileType('book.unknown')).toBe(null);
    });
  });
});

/**
 * Create a minimal test EPUB buffer for testing
 * This creates a basic ZIP structure that mimics an EPUB file
 */
function createTestEpubBuffer(): Buffer {
  // Create a proper minimal ZIP file structure for testing
  // This is a simplified but valid ZIP structure

  const mimetypeContent = Buffer.from('application/epub+zip');
  const htmlContent = Buffer.from(
    '<html><body><h1>Test Chapter</h1><p>This is test EPUB content for testing purposes.</p></body></html>',
  );

  // Create local file headers (using no compression for simplicity)
  const mimetypeHeader = createZipLocalFileHeader(
    'mimetype',
    mimetypeContent,
    0,
  ); // No compression for mimetype
  const htmlHeader = createZipLocalFileHeader(
    'OEBPS/content.html',
    htmlContent,
    0,
  ); // No compression for simplicity

  // Create central directory entries
  const mimetypeCentralDir = createZipCentralDirEntry(
    'mimetype',
    mimetypeContent.length,
    mimetypeContent.length,
    0,
    0,
  );
  const htmlCentralDir = createZipCentralDirEntry(
    'OEBPS/content.html',
    htmlContent.length,
    htmlContent.length,
    0,
    mimetypeHeader.length,
  );

  // Create end of central directory record
  const centralDirOffset = mimetypeHeader.length + htmlHeader.length;
  const centralDirSize = mimetypeCentralDir.length + htmlCentralDir.length;
  const endOfCentralDir = createZipEndOfCentralDir(
    2,
    centralDirSize,
    centralDirOffset,
  );

  // Combine all parts
  return Buffer.concat([
    mimetypeHeader,
    htmlHeader,
    mimetypeCentralDir,
    htmlCentralDir,
    endOfCentralDir,
  ]);
}

/**
 * Create a ZIP local file header
 */
function createZipLocalFileHeader(
  filename: string,
  content: Buffer,
  compressionMethod: number,
): Buffer {
  const filenameBuffer = Buffer.from(filename, 'utf8');
  const header = Buffer.alloc(30 + filenameBuffer.length);

  // Local file header signature
  header.writeUInt32LE(0x04034b50, 0);
  // Version needed to extract
  header.writeUInt16LE(20, 4);
  // General purpose bit flag
  header.writeUInt16LE(0, 6);
  // Compression method
  header.writeUInt16LE(compressionMethod, 8);
  // Last mod file time
  header.writeUInt16LE(0, 10);
  // Last mod file date
  header.writeUInt16LE(0, 12);
  // CRC-32
  header.writeUInt32LE(0, 14); // Simplified - should calculate actual CRC
  // Compressed size
  header.writeUInt32LE(content.length, 18);
  // Uncompressed size
  header.writeUInt32LE(content.length, 22);
  // File name length
  header.writeUInt16LE(filenameBuffer.length, 26);
  // Extra field length
  header.writeUInt16LE(0, 28);

  // Copy filename
  filenameBuffer.copy(header, 30);

  return Buffer.concat([header, content]);
}

/**
 * Create a ZIP central directory entry
 */
function createZipCentralDirEntry(
  filename: string,
  compressedSize: number,
  uncompressedSize: number,
  compressionMethod: number,
  localHeaderOffset: number,
): Buffer {
  const filenameBuffer = Buffer.from(filename, 'utf8');
  const entry = Buffer.alloc(46 + filenameBuffer.length);

  // Central directory file header signature
  entry.writeUInt32LE(0x02014b50, 0);
  // Version made by
  entry.writeUInt16LE(20, 4);
  // Version needed to extract
  entry.writeUInt16LE(20, 6);
  // General purpose bit flag
  entry.writeUInt16LE(0, 8);
  // Compression method
  entry.writeUInt16LE(compressionMethod, 10);
  // Last mod file time
  entry.writeUInt16LE(0, 12);
  // Last mod file date
  entry.writeUInt16LE(0, 14);
  // CRC-32
  entry.writeUInt32LE(0, 16); // Simplified
  // Compressed size
  entry.writeUInt32LE(compressedSize, 20);
  // Uncompressed size
  entry.writeUInt32LE(uncompressedSize, 24);
  // File name length
  entry.writeUInt16LE(filenameBuffer.length, 28);
  // Extra field length
  entry.writeUInt16LE(0, 30);
  // File comment length
  entry.writeUInt16LE(0, 32);
  // Disk number start
  entry.writeUInt16LE(0, 34);
  // Internal file attributes
  entry.writeUInt16LE(0, 36);
  // External file attributes
  entry.writeUInt32LE(0, 38);
  // Relative offset of local header
  entry.writeUInt32LE(localHeaderOffset, 42);

  // Copy filename
  filenameBuffer.copy(entry, 46);

  return entry;
}

/**
 * Create ZIP end of central directory record
 */
function createZipEndOfCentralDir(
  numEntries: number,
  centralDirSize: number,
  centralDirOffset: number,
): Buffer {
  const record = Buffer.alloc(22);

  // End of central dir signature
  record.writeUInt32LE(0x06054b50, 0);
  // Number of this disk
  record.writeUInt16LE(0, 4);
  // Number of the disk with the start of the central directory
  record.writeUInt16LE(0, 6);
  // Total number of entries in the central directory on this disk
  record.writeUInt16LE(numEntries, 8);
  // Total number of entries in the central directory
  record.writeUInt16LE(numEntries, 10);
  // Size of the central directory
  record.writeUInt32LE(centralDirSize, 12);
  // Offset of start of central directory
  record.writeUInt32LE(centralDirOffset, 16);
  // ZIP file comment length
  record.writeUInt16LE(0, 20);

  return record;
}

/**
 * Helper function to create a more realistic test EPUB
 * This would be used if you have actual EPUB test files
 */
function loadTestEpubFile(filename: string): Buffer | null {
  try {
    const testFilePath = join(process.cwd(), 'tests', 'fixtures', filename);
    return readFileSync(testFilePath);
  } catch (error) {
    console.warn(`Test EPUB file ${filename} not found:`, error);
    return null;
  }
}
