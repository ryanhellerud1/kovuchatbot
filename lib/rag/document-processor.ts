import * as mammoth from 'mammoth';
import { generateEmbedding, generateEmbeddings } from './embeddings';
import { parsePDFBuffer, isValidPDFBuffer } from './pdf-parser-json';

/**
 * Supported file types for document processing
 */
export type SupportedFileType = 'pdf' | 'txt' | 'md' | 'docx';

/**
 * Document chunk with metadata
 */
export interface DocumentChunk {
  content: string;
  chunkIndex: number;
  metadata?: {
    startChar?: number;
    endChar?: number;
    tokens?: number;
  };
}

/**
 * Processed document with chunks and embeddings
 */
export interface ProcessedDocument {
  title: string;
  content: string;
  chunks: DocumentChunk[];
  embeddings: number[][];
  fileType: SupportedFileType;
  fileSize: number;
  summary: string;
  firstPageContent: string;
}

/**
 * Extract text content from different file types
 */
export async function extractTextFromFile(
  file: Buffer,
  fileType: SupportedFileType,
  fileName: string,
): Promise<string> {
  try {
    switch (fileType) {
      case 'pdf':
        // Validate PDF buffer first
        if (!isValidPDFBuffer(file)) {
          throw new Error('Invalid PDF file format');
        }

        // Use the pdf2json-based parser
        return await parsePDFBuffer(file, fileName);

      case 'docx':
        try {
          const docxResult = await mammoth.extractRawText({ buffer: file });

          if (!docxResult.value || docxResult.value.trim().length === 0) {
            throw new Error('No text content found in DOCX file');
          }

          return docxResult.value;
        } catch (docxError) {
          console.error('DOCX parsing error:', docxError);
          throw new Error(
            'Failed to parse DOCX file. The file may be corrupted or password-protected.',
          );
        }

      case 'txt':
      case 'md':
        try {
          const textContent = file.toString('utf-8');

          if (!textContent || textContent.trim().length === 0) {
            throw new Error('No text content found in file');
          }

          return textContent;
        } catch (textError) {
          console.error('Text file parsing error:', textError);
          throw new Error(
            'Failed to parse text file. The file may be corrupted or in an unsupported encoding.',
          );
        }

      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }
  } catch (error) {
    console.error(`Error extracting text from ${fileName}:`, error);
    throw new Error(`Failed to extract text from ${fileType} file`);
  }
}

import { encode } from 'gpt-tokenizer';

/**
 * Chunk text into smaller segments with context preservation
 * Uses recursive text splitting with tokenization and overlap
 */
export function chunkText(
  text: string,
  maxTokens = 500, // Removed redundant type annotation
  overlapPercentage = 0.1, // Removed redundant type annotation
): DocumentChunk[] {
  // Clean and normalize text
  const cleanText = text.replace(/\s+/g, ' ').trim();

  // Calculate overlap tokens (10% of maxTokens)
  const overlapTokens = Math.floor(maxTokens * overlapPercentage);

  const chunks: DocumentChunk[] = [];
  let currentPosition = 0;
  let chunkIndex = 0;

  while (currentPosition < cleanText.length) {
    console.log(`Chunking loop: currentPosition=${currentPosition}, cleanText.length=${cleanText.length}`);
    // Find optimal split point (try to split at paragraph, sentence, or word boundaries)
    const splitPosition = currentPosition + maxTokens * 4; // Changed to const
    let splitPoint = -1;

    // Prioritize paragraph breaks
    const paragraphBreak = cleanText.lastIndexOf('\n\n', splitPosition);
    if (paragraphBreak > currentPosition && paragraphBreak <= splitPosition) {
      splitPoint = paragraphBreak;
    }

    // Then sentence boundaries
    if (splitPoint === -1) {
      const sentenceBreak = cleanText.lastIndexOf('.', splitPosition);
      if (sentenceBreak > currentPosition && sentenceBreak <= splitPosition) {
        splitPoint = sentenceBreak + 1; // Include period
      }
    }

    // Then word boundaries
    if (splitPoint === -1) {
      const wordBreak = cleanText.lastIndexOf(' ', splitPosition);
      if (wordBreak > currentPosition && wordBreak <= splitPosition) {
        splitPoint = wordBreak;
      }
    }

    // If no natural break found, use max position
    if (splitPoint === -1) {
      splitPoint = Math.min(cleanText.length, splitPosition);
    }

    // Extract chunk content
    const chunkContent = cleanText
      .substring(currentPosition, splitPoint)
      .trim();

    // Calculate actual tokens
    console.log('Encoding chunk content to calculate tokens...');
    const tokenCount = encode(chunkContent).length;
    console.log(`Token count for chunk: ${tokenCount}`);

    // Add chunk only if it has content
    if (chunkContent.length > 0) {
      chunks.push({
        content: chunkContent,
        chunkIndex,
        metadata: {
          startChar: currentPosition,
          endChar: splitPoint,
          tokens: tokenCount,
        },
      });
    }

    // Move position with overlap
    const overlapChars = Math.min(overlapTokens * 4, chunkContent.length);
    let nextPosition = splitPoint - overlapChars;

    // Ensure nextPosition always moves forward
    if (nextPosition <= currentPosition) {
        nextPosition = currentPosition + 1; // Move by at least one character
    }
    currentPosition = nextPosition;
    chunkIndex++;
  }

  return chunks;
}

/**
 * Generate a concise summary of the document content
 */
export function generateSummary(content: string, maxLength = 150): string {
  // Remove excessive whitespace and newlines
  const cleanedContent = content.replace(/\s+/g, ' ').trim();
  
  // Truncate to maxLength
  if (cleanedContent.length <= maxLength) {
    return cleanedContent;
  }
  
  // Find the last space within the maxLength to avoid cutting words
  const lastSpace = cleanedContent.lastIndexOf(' ', maxLength);
  const summary = cleanedContent.substring(0, lastSpace > 0 ? lastSpace : maxLength);
  
  return `${summary}...`;
}

/**
 * Process a document file into chunks with embeddings
 */
export async function processDocument(
  file: Buffer,
  fileName: string,
  fileType: SupportedFileType,
): Promise<ProcessedDocument> {
  try {
    // Extract text content
    console.log('Starting text extraction...');
    const content = await extractTextFromFile(file, fileType, fileName);
    console.log(`Text extraction complete. Content length: ${content.length}`);

    if (!content || content.trim().length === 0) {
      throw new Error('No text content found in document');
    }

    // Chunk the text
    console.log('Starting text chunking...');
    const chunks = chunkText(content);
    console.log(`Text chunking complete. Number of chunks: ${chunks.length}`);

    if (chunks.length === 0) {
      throw new Error('No chunks generated from document');
    }

    // Generate embeddings for all chunks
    console.log('Starting embedding generation...');
    const chunkTexts = chunks.map((chunk) => chunk.content);
    const embeddings = await generateEmbeddings(chunkTexts);
    console.log(`Embedding generation complete. Number of embeddings: ${embeddings.length}`);

    // Extract title from filename (remove extension)
    const title = fileName.replace(/\.[^/.]+$/, '');

    // Generate summary and first page content
    const summary = generateSummary(content);
    const firstPageContent = chunks.length > 0 ? chunks[0].content : '';

    return {
      title,
      content,
      chunks,
      embeddings,
      fileType,
      fileSize: file.length,
      summary,
      firstPageContent,
    };
  } catch (error) {
    console.error(`Error processing document ${fileName}:`, error);
    throw error;
  }
}

/**
 * Validate file type based on filename
 */
export function getFileType(fileName: string): SupportedFileType | null {
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
    default:
      return null;
  }
}

/**
 * Validate file size (max 10MB)
 */
export function validateFileSize(
  fileSize: number,
  maxSize: number = 10 * 1024 * 1024,
): boolean {
  return fileSize <= maxSize;
}
