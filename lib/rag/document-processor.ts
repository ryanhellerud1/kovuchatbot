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
}

/**
 * Extract text content from different file types
 */
export async function extractTextFromFile(
  file: Buffer,
  fileType: SupportedFileType,
  fileName: string
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
          throw new Error('Failed to parse DOCX file. The file may be corrupted or password-protected.');
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
          throw new Error('Failed to parse text file. The file may be corrupted or in an unsupported encoding.');
        }
        
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }
  } catch (error) {
    console.error(`Error extracting text from ${fileName}:`, error);
    throw new Error(`Failed to extract text from ${fileType} file`);
  }
}

/**
 * Chunk text into smaller segments for better embedding performance
 * Uses sentence-based chunking with token estimation
 */
export function chunkText(text: string, maxTokens: number = 500): DocumentChunk[] {
  // Clean and normalize text
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  // Split into sentences (basic approach)
  const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  const chunks: DocumentChunk[] = [];
  let currentChunk = '';
  let currentStartChar = 0;
  let chunkIndex = 0;

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) continue;
    
    const potentialChunk = currentChunk + (currentChunk ? '. ' : '') + trimmedSentence + '.';
    
    // Rough token estimation (1 token ≈ 4 characters for English)
    const estimatedTokens = potentialChunk.length / 4;
    
    if (estimatedTokens > maxTokens && currentChunk.length > 0) {
      // Save current chunk
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex,
        metadata: {
          startChar: currentStartChar,
          endChar: currentStartChar + currentChunk.length,
          tokens: Math.ceil(currentChunk.length / 4),
        },
      });
      
      // Start new chunk
      currentStartChar += currentChunk.length;
      currentChunk = trimmedSentence + '.';
      chunkIndex++;
    } else {
      currentChunk = potentialChunk;
    }
  }

  // Add the last chunk if it has content
  if (currentChunk.trim().length > 0) {
    chunks.push({
      content: currentChunk.trim(),
      chunkIndex,
      metadata: {
        startChar: currentStartChar,
        endChar: currentStartChar + currentChunk.length,
        tokens: Math.ceil(currentChunk.length / 4),
      },
    });
  }

  return chunks;
}

/**
 * Process a document file into chunks with embeddings
 */
export async function processDocument(
  file: Buffer,
  fileName: string,
  fileType: SupportedFileType
): Promise<ProcessedDocument> {
  try {
    // Extract text content
    const content = await extractTextFromFile(file, fileType, fileName);
    
    if (!content || content.trim().length === 0) {
      throw new Error('No text content found in document');
    }

    // Chunk the text
    const chunks = chunkText(content);
    
    if (chunks.length === 0) {
      throw new Error('No chunks generated from document');
    }

    // Generate embeddings for all chunks
    const chunkTexts = chunks.map(chunk => chunk.content);
    const embeddings = await generateEmbeddings(chunkTexts);

    // Extract title from filename (remove extension)
    const title = fileName.replace(/\.[^/.]+$/, '');

    return {
      title,
      content,
      chunks,
      embeddings,
      fileType,
      fileSize: file.length,
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
export function validateFileSize(fileSize: number, maxSize: number = 10 * 1024 * 1024): boolean {
  return fileSize <= maxSize;
}