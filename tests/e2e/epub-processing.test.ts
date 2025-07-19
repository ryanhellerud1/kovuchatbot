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
  // Create a minimal ZIP buffer with EPUB-like structure
  // In a real test environment, you would load an actual EPUB file
  const zipSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // ZIP local file header signature
  const mimetypeContent = Buffer.from('application/epub+zip');
  const basicContent = Buffer.from(
    'This is test EPUB content for testing purposes.',
  );

  // Create a simple buffer that passes basic validation
  return Buffer.concat([
    zipSignature,
    Buffer.alloc(26), // ZIP header fields
    Buffer.from('mimetype'), // filename
    mimetypeContent,
    zipSignature,
    Buffer.alloc(26), // ZIP header fields
    Buffer.from('content.html'), // filename
    basicContent,
  ]);
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
