import type { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { parseEPUBBuffer, parseEPUBWithMetadata } from './epub-parser';
import { createLangChainEmbeddings } from '@/lib/ai/langchain-providers';
import {
  withLangChainErrorHandling,
  withLangChainTiming,
} from '@/lib/ai/langchain-utils';
import type { LangChainDocument } from '@/lib/ai/langchain-types';
import {
  sanitizeTextPreserveFormatting,
  sanitizeMetadata,
  logSanitizationStats,
} from '@/lib/utils/text-sanitizer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Supported file types for LangChain document processing
 */
export type LangChainSupportedFileType = 'pdf' | 'txt' | 'md' | 'docx' | 'epub';

/**
 * LangChain processed document with chunks and embeddings
 */
export interface LangChainProcessedDocument {
  title: string;
  content: string;
  documents: LangChainDocument[];
  embeddings: number[][];
  fileType: LangChainSupportedFileType;
  fileSize: number;
  summary: string;
  metadata: {
    chunkCount: number;
    avgChunkSize: number;
    processingTime: number;
  };
}

/**
 * LangChain document processing configuration
 */
export interface LangChainDocumentConfig {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
  keepSeparator?: boolean;
  lengthFunction?: (text: string) => number;
}

/**
 * Default configuration for LangChain document processing
 */
export const DEFAULT_LANGCHAIN_CONFIG: LangChainDocumentConfig = {
  chunkSize: 1000,
  chunkOverlap: 200,
  separators: ['\n\n', '\n', ' ', ''],
  keepSeparator: false,
};

/**
 * Create a temporary file from buffer for LangChain loaders
 */
async function createTempFile(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(
    tempDir,
    `langchain_${Date.now()}_${fileName}`,
  );

  await fs.promises.writeFile(tempFilePath, buffer);
  return tempFilePath;
}

/**
 * Clean up temporary file
 */
async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    console.warn(`Failed to cleanup temp file ${filePath}:`, error);
  }
}

/**
 * Load documents using LangChain document loaders
 */
export async function loadDocumentWithLangChain(
  file: Buffer,
  fileName: string,
  fileType: LangChainSupportedFileType,
): Promise<Document[]> {
  return withLangChainErrorHandling('loadDocument', async () => {
    return withLangChainTiming('loadDocument', async () => {
      let tempFilePath: string | null = null;

      try {
        // Create temporary file for LangChain loaders
        tempFilePath = await createTempFile(file, fileName);

        let loader: PDFLoader | DocxLoader | TextLoader;

        switch (fileType) {
          case 'pdf':
            loader = new PDFLoader(tempFilePath, {
              splitPages: false, // We'll handle chunking separately
            });
            break;

          case 'docx':
            loader = new DocxLoader(tempFilePath);
            break;

          case 'txt':
          case 'md':
            loader = new TextLoader(tempFilePath);
            break;

          case 'epub': {
            // Handle EPUB files using our custom parser with metadata
            console.log(`[LangChain] Loading EPUB document with custom parser`);
            const epubResult = await parseEPUBWithMetadata(file, fileName);

            // Create a Document object similar to other loaders
            const epubDocument: Document = {
              pageContent: epubResult.content,
              metadata: {
                source: tempFilePath,
                fileName,
                fileType: 'epub',
                epubMetadata: epubResult.metadata,
                totalChapters: epubResult.chapters.length,
                chapterTitles: epubResult.chapters.map((ch) => ch.title),
              },
            };

            const documents = [epubDocument];

            // Apply the same sanitization and metadata enhancement as other document types
            documents.forEach((doc, index) => {
              // Sanitize the page content to remove null bytes and problematic characters
              const originalContent = doc.pageContent;
              doc.pageContent = sanitizeTextPreserveFormatting(originalContent);

              // Log sanitization if changes were made
              if (originalContent !== doc.pageContent) {
                logSanitizationStats(
                  originalContent,
                  doc.pageContent,
                  `document ${index + 1}`,
                );
              }

              // Sanitize and add metadata including EPUB-specific fields
              doc.metadata = sanitizeMetadata({
                ...doc.metadata,
                fileName,
                fileType,
                fileSize: file.length,
                loadedAt: new Date().toISOString(),
                documentIndex: index,
                // EPUB-specific metadata
                epubTitle: epubResult.metadata.title,
                epubAuthor: epubResult.metadata.author?.join(', '),
                epubPublisher: epubResult.metadata.publisher,
                epubLanguage: epubResult.metadata.language,
              });
            });

            console.log(
              `[LangChain] Loaded ${documents.length} document(s) from ${fileName} with ${epubResult.chapters.length} chapters`,
            );
            return documents;
          }

          default:
            throw new Error(`Unsupported file type for LangChain: ${fileType}`);
        }

        console.log(
          `[LangChain] Loading document with ${loader.constructor.name}`,
        );
        const documents = await loader.load();

        if (!documents || documents.length === 0) {
          throw new Error('No content loaded from document');
        }

        // Sanitize document content and add file metadata
        documents.forEach((doc, index) => {
          // Sanitize the page content to remove null bytes and problematic characters
          const originalContent = doc.pageContent;
          doc.pageContent = sanitizeTextPreserveFormatting(originalContent);

          // Log sanitization if changes were made
          if (originalContent !== doc.pageContent) {
            logSanitizationStats(
              originalContent,
              doc.pageContent,
              `document ${index + 1}`,
            );
          }

          // Sanitize and add metadata
          doc.metadata = sanitizeMetadata({
            ...doc.metadata,
            fileName,
            fileType,
            fileSize: file.length,
            loadedAt: new Date().toISOString(),
            documentIndex: index,
          });
        });

        console.log(
          `[LangChain] Loaded ${documents.length} document(s) from ${fileName}`,
        );
        return documents;
      } finally {
        // Cleanup temporary file
        if (tempFilePath) {
          await cleanupTempFile(tempFilePath);
        }
      }
    });
  });
}

/**
 * Split documents into chunks using LangChain text splitter
 */
export async function splitDocumentsWithLangChain(
  documents: Document[],
  config: LangChainDocumentConfig = DEFAULT_LANGCHAIN_CONFIG,
): Promise<LangChainDocument[]> {
  return withLangChainErrorHandling('splitDocuments', async () => {
    return withLangChainTiming('splitDocuments', async () => {
      // Check if we're processing EPUB documents to use EPUB-aware separators
      const hasEpubDocuments = documents.some(
        (doc) => doc.metadata.fileType === 'epub',
      );

      // Use EPUB-aware separators if processing EPUB content
      const separators = hasEpubDocuments
        ? [
            '\n\n\n', // Chapter breaks (multiple line breaks)
            '\n\n', // Paragraph breaks
            '\n', // Line breaks
            '. ', // Sentence endings
            '! ',
            '? ',
            '; ', // Clause separators
            ', ', // Phrase separators
            ' ', // Word separators
            '', // Character level
          ]
        : config.separators || DEFAULT_LANGCHAIN_CONFIG.separators;

      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: config.chunkSize || DEFAULT_LANGCHAIN_CONFIG.chunkSize,
        chunkOverlap:
          config.chunkOverlap || DEFAULT_LANGCHAIN_CONFIG.chunkOverlap,
        separators,
        keepSeparator:
          config.keepSeparator || DEFAULT_LANGCHAIN_CONFIG.keepSeparator,
        lengthFunction: config.lengthFunction,
      });

      console.log(
        `[LangChain] Splitting ${documents.length} documents with chunk size ${config.chunkSize}`,
      );

      const splitDocs = await textSplitter.splitDocuments(documents);

      // Convert to LangChainDocument format and add chunk metadata
      const langchainDocs: LangChainDocument[] = splitDocs.map((doc, index) => {
        const langchainDoc = doc as LangChainDocument;

        // Sanitize chunk content
        const originalContent = langchainDoc.pageContent;
        langchainDoc.pageContent =
          sanitizeTextPreserveFormatting(originalContent);

        // Log sanitization if changes were made
        if (originalContent !== langchainDoc.pageContent) {
          logSanitizationStats(
            originalContent,
            langchainDoc.pageContent,
            `chunk ${index + 1}`,
          );
        }

        // Enhance and sanitize metadata with chunk information
        langchainDoc.metadata = sanitizeMetadata({
          ...langchainDoc.metadata,
          chunkIndex: index,
          chunkSize: langchainDoc.pageContent.length,
          documentId: '', // Will be set when saving to database
          documentTitle: langchainDoc.metadata.fileName || 'Unknown Document',
        });

        return langchainDoc;
      });

      console.log(`[LangChain] Split into ${langchainDocs.length} chunks`);
      return langchainDocs;
    });
  });
}

/**
 * Generate embeddings for LangChain documents
 */
export async function generateEmbeddingsForDocuments(
  documents: LangChainDocument[],
): Promise<number[][]> {
  return withLangChainErrorHandling('generateEmbeddings', async () => {
    return withLangChainTiming('generateEmbeddings', async () => {
      const embeddings = createLangChainEmbeddings();

      console.log(
        `[LangChain] Generating embeddings for ${documents.length} documents`,
      );

      // Extract text content from documents
      const texts = documents.map((doc) => doc.pageContent);

      // Generate embeddings in batches to avoid API limits
      const batchSize = 100; // OpenAI embedding API limit
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        console.log(
          `[LangChain] Processing embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}`,
        );

        const batchEmbeddings = await embeddings.embedDocuments(batch);
        allEmbeddings.push(...batchEmbeddings);
      }

      console.log(`[LangChain] Generated ${allEmbeddings.length} embeddings`);
      return allEmbeddings;
    });
  });
}

/**
 * Process a document file using LangChain components
 */
export async function processDocumentWithLangChain(
  file: Buffer,
  fileName: string,
  fileType: LangChainSupportedFileType,
  config: LangChainDocumentConfig = DEFAULT_LANGCHAIN_CONFIG,
): Promise<LangChainProcessedDocument> {
  return withLangChainErrorHandling('processDocument', async () => {
    return withLangChainTiming('processDocument', async () => {
      const startTime = Date.now();

      console.log(`[LangChain] Starting document processing for ${fileName}`);

      // Step 1: Load document using LangChain loaders
      const loadedDocuments = await loadDocumentWithLangChain(
        file,
        fileName,
        fileType,
      );

      // Step 2: Split documents into chunks
      const splitDocuments = await splitDocumentsWithLangChain(
        loadedDocuments,
        config,
      );

      // Step 3: Generate embeddings
      const embeddings = await generateEmbeddingsForDocuments(splitDocuments);

      // Step 4: Extract metadata and create summary
      const fullContent = loadedDocuments
        .map((doc) => doc.pageContent)
        .join('\n\n');
      const sanitizedFullContent = sanitizeTextPreserveFormatting(fullContent);
      const title = fileName.replace(/\.[^/.]+$/, '');
      const summary = generateSummary(sanitizedFullContent);

      // Log full content sanitization if changes were made
      if (fullContent !== sanitizedFullContent) {
        logSanitizationStats(
          fullContent,
          sanitizedFullContent,
          'full document content',
        );
      }

      const processingTime = Date.now() - startTime;
      const avgChunkSize =
        splitDocuments.reduce((sum, doc) => sum + doc.pageContent.length, 0) /
        splitDocuments.length;

      console.log(
        `[LangChain] Document processing completed in ${processingTime}ms`,
      );

      return {
        title,
        content: sanitizedFullContent,
        documents: splitDocuments,
        embeddings,
        fileType,
        fileSize: file.length,
        summary,
        metadata: {
          chunkCount: splitDocuments.length,
          avgChunkSize: Math.round(avgChunkSize),
          processingTime,
        },
      };
    });
  });
}

/**
 * Generate a concise summary of the document content
 */
function generateSummary(content: string, maxLength = 150): string {
  // Remove excessive whitespace and newlines
  const cleanedContent = content.replace(/\s+/g, ' ').trim();

  // Truncate to maxLength
  if (cleanedContent.length <= maxLength) {
    return cleanedContent;
  }

  // Find the last space within the maxLength to avoid cutting words
  const lastSpace = cleanedContent.lastIndexOf(' ', maxLength);
  const summary = cleanedContent.substring(
    0,
    lastSpace > 0 ? lastSpace : maxLength,
  );

  return `${summary}...`;
}

/**
 * Validate file type for LangChain processing
 */
export function validateLangChainFileType(
  fileName: string,
): LangChainSupportedFileType | null {
  const extension = fileName.toLowerCase().split('.').pop();

  switch (extension) {
    case 'pdf':
      return 'pdf';
    case 'txt':
      return 'txt';
    case 'md':
    case 'markdown':
      return 'md';
    case 'docx':
      return 'docx';
    case 'epub':
      return 'epub';
    default:
      return null;
  }
}

/**
 * Compare LangChain processing with legacy processing
 */
export async function compareLangChainWithLegacy(
  file: Buffer,
  fileName: string,
  fileType: LangChainSupportedFileType,
): Promise<{
  langchain: LangChainProcessedDocument;
  legacy: any; // Will be the legacy ProcessedDocument
  comparison: {
    chunkCountDiff: number;
    avgChunkSizeDiff: number;
    processingTimeDiff: number;
  };
}> {
  // Import legacy processor
  const { processDocument: legacyProcessDocument } = await import(
    './retriever'
  );

  const startTime = Date.now();

  // Process with both systems
  const [langchainResult, legacyResult] = await Promise.all([
    processDocumentWithLangChain(file, fileName, fileType),
    legacyProcessDocument(file, fileName, fileType as any),
  ]);

  const comparison = {
    chunkCountDiff:
      langchainResult.metadata.chunkCount - legacyResult.chunks.length,
    avgChunkSizeDiff:
      langchainResult.metadata.avgChunkSize -
      legacyResult.chunks.reduce(
        (sum: number, chunk: any) => sum + chunk.content.length,
        0,
      ) /
        legacyResult.chunks.length,
    processingTimeDiff:
      langchainResult.metadata.processingTime - (Date.now() - startTime),
  };

  console.log('[LangChain] Processing comparison:', comparison);

  return {
    langchain: langchainResult,
    legacy: legacyResult,
    comparison,
  };
}
