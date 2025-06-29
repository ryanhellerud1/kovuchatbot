import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { VectorStore } from '@langchain/core/vectorstores';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { cosineSimilarity } from './similarity';
import { getUserDocumentChunks, saveKnowledgeDocument, saveDocumentChunk } from '@/lib/db/queries';
import { processDocumentWithLangChain } from './langchain-document-processor';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * LangChain-based RAG implementation that replaces the custom RAG system
 * while maintaining compatibility with existing database schema and AI SDK
 */

export interface LangChainRAGConfig {
  chunkSize?: number;
  chunkOverlap?: number;
  embeddingModel?: string;
  similarityThreshold?: number;
}

const DEFAULT_CONFIG: LangChainRAGConfig = {
  chunkSize: 1000,
  chunkOverlap: 200,
  embeddingModel: 'text-embedding-3-small',
  similarityThreshold: 0.4,
};

/**
 * Simple PostgreSQL Vector Store that doesn't extend LangChain VectorStore
 * to avoid compatibility issues
 */
class SimplePostgreSQLVectorStore {
  private userId: string;
  private embeddings: OpenAIEmbeddings;

  constructor(embeddings: OpenAIEmbeddings, userId: string) {
    this.embeddings = embeddings;
    this.userId = userId;
  }

  async addDocuments(documents: Document[], options?: { documentId?: string; documentTitle?: string }): Promise<string[]> {
    const texts = documents.map(doc => doc.pageContent);
    const embeddings = await this.embeddings.embedDocuments(texts);

    const chunks = documents.map((doc, index) => ({
      documentId: options?.documentId || 'unknown',
      chunkIndex: index,
      content: doc.pageContent,
      embedding: embeddings[index],
      chunkMetadata: doc.metadata || {},
    }));

    await saveDocumentChunks(chunks);
    return chunks.map((_, index) => `${options?.documentId}_${index}`);
  }

  async addVectors(vectors: number[][], documents: Document[]): Promise<string[]> {
    // Not implemented for this use case
    throw new Error('addVectors not implemented');
  }

  async similaritySearchWithScore(query: string, k: number = 4): Promise<[Document, number][]> {
    const queryEmbedding = await this.embeddings.embedQuery(query);
    const chunks = await getUserDocumentChunks(this.userId);

    const results: Array<{ document: Document; score: number }> = [];

    for (const chunk of chunks) {
      if (!chunk.embedding || !Array.isArray(chunk.embedding)) continue;

      const similarity = cosineSimilarity(queryEmbedding, chunk.embedding as number[]);
      
      const document = new Document({
        pageContent: chunk.content,
        metadata: {
          documentId: chunk.documentId,
          documentTitle: chunk.documentTitle,
          chunkIndex: chunk.chunkIndex,
          similarity,
        },
      });

      results.push({ document, score: similarity });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k).map(result => [result.document, result.score]);
  }

  async similaritySearch(query: string, k: number = 4): Promise<Document[]> {
    const results = await this.similaritySearchWithScore(query, k);
    return results.map(([document]) => document);
  }

  async delete(): Promise<void> {
    // Not implemented
  }
}

/**
 * Supported file types for LangChain document processing
 */
export type SupportedFileType = 'pdf' | 'txt' | 'md' | 'docx';

/**
 * Helper function to save multiple document chunks
 */
async function saveDocumentChunks(chunks: Array<{
  documentId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  chunkMetadata?: any;
}>): Promise<void> {
  const chunkPromises = chunks.map(async (chunk) => {
    return saveDocumentChunk({
      documentId: chunk.documentId,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      embedding: chunk.embedding,
      metadata: chunk.chunkMetadata,
    });
  });

  await Promise.all(chunkPromises);
}

/**
 * Document chunk with metadata (compatible with legacy interface)
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
 * Processed document with chunks and embeddings (compatible with legacy interface)
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
 * Create a temporary file from buffer for LangChain loaders
 */
async function createTempFile(buffer: Buffer, fileName: string): Promise<string> {
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `langchain_${Date.now()}_${fileName}`);
  
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
  fileType: SupportedFileType,
): Promise<Document[]> {
  let tempFilePath: string | null = null;
  
  try {
    // For text files, we can process directly
    if (fileType === 'txt' || fileType === 'md') {
      const content = file.toString('utf-8');
      if (!content || content.trim().length === 0) {
        throw new Error('No text content found in file');
      }
      return [new Document({
        pageContent: content,
        metadata: { fileName, fileType, fileSize: file.length }
      })];
    }

    // For binary files, create temporary file for LangChain loaders
    tempFilePath = await createTempFile(file, fileName);
    
    let loader;
    
    switch (fileType) {
      case 'pdf':
        loader = new PDFLoader(tempFilePath, {
          splitPages: false, // We'll handle chunking separately
        });
        break;
        
      case 'docx':
        loader = new DocxLoader(tempFilePath);
        break;
        
      default:
        throw new Error(`Unsupported file type for LangChain: ${fileType}`);
    }
    
    console.log(`[LangChain] Loading document with ${loader.constructor.name}`);
    const documents = await loader.load();
    
    if (!documents || documents.length === 0) {
      throw new Error('No content loaded from document');
    }
    
    // Add file metadata to documents
    documents.forEach((doc, index) => {
      doc.metadata = {
        ...doc.metadata,
        fileName,
        fileType,
        fileSize: file.length,
        loadedAt: new Date().toISOString(),
        documentIndex: index,
      };
    });
    
    console.log(`[LangChain] Loaded ${documents.length} document(s) from ${fileName}`);
    return documents;
    
  } finally {
    // Cleanup temporary file
    if (tempFilePath) {
      await cleanupTempFile(tempFilePath);
    }
  }
}

/**
 * LangChain-based document processor (replaces legacy processDocument)
 */
export async function processDocument(
  file: Buffer,
  fileName: string,
  fileType: SupportedFileType,
  config: LangChainRAGConfig = DEFAULT_CONFIG
): Promise<ProcessedDocument> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    console.log(`[LangChain] Processing document: ${fileName}`);
    
    // Load document using LangChain loaders
    const loadedDocuments = await loadDocumentWithLangChain(file, fileName, fileType);
    
    // Combine all document content
    const fullContent = loadedDocuments.map(doc => doc.pageContent).join('\n\n');
    
    if (!fullContent || fullContent.trim().length === 0) {
      throw new Error('No text content found in document');
    }

    // Split text using LangChain's text splitter
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: finalConfig.chunkSize!,
      chunkOverlap: finalConfig.chunkOverlap!,
      separators: ['\n\n', '\n', ' ', ''],
    });

    const documents = await textSplitter.createDocuments([fullContent], [{ 
      title: fileName.replace(/\.[^/.]+$/, ''),
      fileName,
      fileType 
    }]);

    console.log(`[LangChain] Split into ${documents.length} chunks`);

    // Generate embeddings
    const embeddings = new OpenAIEmbeddings({
      modelName: finalConfig.embeddingModel!,
    });

    const texts = documents.map(doc => doc.pageContent);
    const embeddingVectors = await embeddings.embedDocuments(texts);

    console.log(`[LangChain] Generated ${embeddingVectors.length} embeddings`);

    // Convert to legacy-compatible format
    const chunks: DocumentChunk[] = documents.map((doc, index) => ({
      content: doc.pageContent,
      chunkIndex: index,
      metadata: {
        startChar: 0, // LangChain doesn't provide character positions
        endChar: doc.pageContent.length,
        tokens: Math.ceil(doc.pageContent.length / 4), // Rough token estimate
      },
    }));

    // Extract title from filename (remove extension)
    const title = fileName.replace(/\.[^/.]+$/, '');

    // Generate summary and first page content
    const summary = generateSummary(fullContent);
    const firstPageContent = chunks.length > 0 ? chunks[0].content : '';

    return {
      title,
      content: fullContent,
      chunks,
      embeddings: embeddingVectors,
      fileType,
      fileSize: file.length,
      summary,
      firstPageContent,
    };
  } catch (error) {
    console.error(`[LangChain] Error processing document ${fileName}:`, error);
    throw error;
  }
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
  const summary = cleanedContent.substring(0, lastSpace > 0 ? lastSpace : maxLength);
  
  return `${summary}...`;
}

/**
 * Search result with content and metadata (compatible with legacy interface)
 */
export interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  source: {
    documentId: string;
    documentTitle: string;
    chunkIndex: number;
  };
  metadata?: any;
}

/**
 * Search options for document retrieval (compatible with legacy interface)
 */
export interface SearchOptions {
  limit?: number;
  minSimilarity?: number;
  includeMetadata?: boolean;
}

/**
 * LangChain-based knowledge search (replaces legacy searchKnowledgeBase)
 */
export async function searchKnowledgeBase(
  query: string,
  userId: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 10, minSimilarity = 0.4, includeMetadata = true } = options;

  try {
    console.log(`[LangChain] Starting search for user ${userId} with query: "${query}"`);
    
    const embeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small',
    });

    const vectorStore = new SimplePostgreSQLVectorStore(embeddings, userId);
    const results = await vectorStore.similaritySearchWithScore(query, limit * 2); // Get more to filter

    console.log(`[LangChain] Retrieved ${results.length} initial results`);

    // Filter by similarity threshold and format results
    const filteredResults = results
      .filter(([, score]) => score >= minSimilarity)
      .slice(0, limit)
      .map(([document, score]) => ({
        id: document.metadata.id || 'unknown',
        content: document.pageContent,
        similarity: score,
        source: {
          documentId: document.metadata.documentId,
          documentTitle: document.metadata.documentTitle,
          chunkIndex: document.metadata.chunkIndex,
        },
        metadata: includeMetadata ? document.metadata : undefined,
      }));

    console.log(`[LangChain] Found ${filteredResults.length} results above similarity threshold ${minSimilarity}`);
    
    if (filteredResults.length > 0) {
      const similarities = filteredResults.map(r => r.similarity);
      console.log(`[LangChain] Similarity range: ${Math.min(...similarities).toFixed(3)} - ${Math.max(...similarities).toFixed(3)}`);
    }

    return filteredResults;
  } catch (error) {
    console.error('[LangChain] Error searching knowledge base:', error);
    throw new Error('Failed to search knowledge base');
  }
}

/**
 * Save processed document using LangChain processing
 */
export async function saveDocumentWithLangChain(
  userId: string,
  title: string,
  content: string,
  fileType: string,
  fileSize: number,
  fileUrl?: string,
  config: LangChainRAGConfig = DEFAULT_CONFIG
): Promise<string> {
  // Process document with LangChain - convert content to buffer
  const contentBuffer = Buffer.from(content, 'utf-8');
  const fileName = `${title}.txt`; // Default to txt for string content
  const { documents, embeddings } = await processDocumentWithLangChain(contentBuffer, fileName, 'txt', config);

  // Save knowledge document
  const knowledgeDoc = await saveKnowledgeDocument({
    userId,
    title,
    content,
    fileType: fileType as any,
    fileSize,
    fileUrl,
    metadata: {
      chunkCount: documents.length,
      processedWithLangChain: true,
      processingConfig: config,
    },
  });

  // Save document chunks with embeddings
  const chunks = documents.map((doc, index) => ({
    documentId: knowledgeDoc.id,
    chunkIndex: index,
    content: doc.pageContent,
    embedding: embeddings[index],
    chunkMetadata: {
      ...doc.metadata,
      processedWithLangChain: true,
    },
  }));

  await saveDocumentChunks(chunks);

  return knowledgeDoc.id;
}

/**
 * Factory function to create LangChain embeddings
 */
export function createLangChainEmbeddings(modelName = 'text-embedding-3-small'): OpenAIEmbeddings {
  return new OpenAIEmbeddings({
    modelName,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });
}

/**
 * Validate file type based on filename (compatible with legacy)
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
 * Validate file size (max 10MB) (compatible with legacy)
 */
export function validateFileSize(
  fileSize: number,
  maxSize: number = 10 * 1024 * 1024,
): boolean {
  return fileSize <= maxSize;
}

/**
 * Generate embeddings for a single text (compatible with legacy)
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const embeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small',
    });
    
    const embedding = await embeddings.embedQuery(text);
    return embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    
    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        throw new Error('OpenAI API key is missing or invalid. Please check your OPENAI_API_KEY environment variable.');
      } else if (error.message.includes('quota')) {
        throw new Error('OpenAI API quota exceeded. Please check your OpenAI account usage.');
      } else if (error.message.includes('rate limit')) {
        throw new Error('OpenAI API rate limit exceeded. Please try again later.');
      }
    }
    
    throw new Error('Failed to generate embedding. Please check your OpenAI API configuration.');
  }
}

/**
 * Generate embeddings for multiple texts in batch (compatible with legacy)
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  try {
    const embeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small',
    });
    
    const embeddingVectors = await embeddings.embedDocuments(texts);
    return embeddingVectors;
  } catch (error) {
    console.error('Error generating embeddings:', error);
    
    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        throw new Error('OpenAI API key is missing or invalid. Please check your OPENAI_API_KEY environment variable.');
      } else if (error.message.includes('quota')) {
        throw new Error('OpenAI API quota exceeded. Please check your OpenAI account usage.');
      } else if (error.message.includes('rate limit')) {
        throw new Error('OpenAI API rate limit exceeded. Please try again later.');
      }
    }
    
    throw new Error('Failed to generate embeddings. Please check your OpenAI API configuration.');
  }
}

/**
 * Simple text chunking function for testing purposes
 */
export function chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start = end - overlap;
    
    // Avoid infinite loop if overlap is too large
    if (start >= end) {
      break;
    }
  }
  
  return chunks;
}

/**
 * Get the dimension of the embedding model
 * text-embedding-3-small has 1536 dimensions
 */
export const EMBEDDING_DIMENSION = 1536;