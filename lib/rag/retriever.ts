import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { createPostgreSQLVectorStore } from './langchain-vector-store';
import { getUserDocumentChunks, saveKnowledgeDocument, saveDocumentChunk } from '@/lib/db/queries';
import { processDocumentWithLangChain } from './langchain-document-processor';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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
  chunkSize: 1500,      // Increased chunk size for better context
  chunkOverlap: 300,    // Increased overlap to maintain context between chunks
  embeddingModel: 'text-embedding-3-small',
  similarityThreshold: 0.25, // Much lower default threshold for comprehensive results
};

// Remove the custom vector store - we'll use the proper LangChain one from langchain-vector-store.ts

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

    // Split text using LangChain's text splitter with improved chunking strategy
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: finalConfig.chunkSize!,
      chunkOverlap: finalConfig.chunkOverlap!,
      // Use more natural text boundaries for chunking
      separators: [
        "\n## ", // Markdown headers
        "\n### ",
        "\n#### ",
        "\n\n", // Paragraphs
        "\n", // Lines
        ". ", // Sentences
        "! ",
        "? ",
        "; ",
        ":", // Clauses
        ", ", // Phrases
        " ", // Words
        "" // Characters
      ],
      // Keep semantically meaningful chunks
      keepSeparator: true,
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
  keywordBoost?: number; // Added to track keyword boosting
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
/**
 * Preprocess query to improve search quality
 */
function preprocessQuery(query: string): string {
  // Remove extra whitespace
  let processedQuery = query.trim().replace(/\s+/g, ' ');
  
  // Remove common filler words that don't add semantic meaning
  const fillerWords = /\b(the|a|an|and|or|but|is|are|was|were|be|been|being|in|on|at|to|for|with|by|about|like|through|over|before|after|since|during)\b/gi;
  processedQuery = processedQuery.replace(fillerWords, ' ').replace(/\s+/g, ' ').trim();
  
  return processedQuery;
}

/**
 * Generate query variations to improve recall
 */
function generateQueryVariations(query: string): string[] {
  const variations: string[] = [query];
  const words = query.split(/\s+/);
  
  // Add variations without question words
  if (/^(what|how|why|when|where|who|which)\b/i.test(query)) {
    variations.push(query.replace(/^(what|how|why|when|where|who|which)\s+/i, ''));
  }
  
  // For longer queries, add a version with just the key terms
  if (words.length > 4) {
    // Remove common words and keep only potential keywords
    const keywords = words.filter(word => 
      word.length > 3 && 
      !/^(what|how|why|when|where|who|which|about|should|could|would|will|have|this|that|these|those|they|their|there)$/i.test(word)
    );
    
    if (keywords.length > 1) {
      variations.push(keywords.join(' '));
    }
  }
  
  return variations;
}

export async function searchKnowledgeBase(
  query: string,
  userId: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 15, minSimilarity = 0.25, includeMetadata = true } = options;

  try {
    console.log(`[LangChain] Starting search for user ${userId} with query: "${query}"`);
    
    // Preprocess the query
    const processedQuery = preprocessQuery(query);
    console.log(`[LangChain] Processed query: "${processedQuery}"`);
    
    // Generate query variations for better recall
    const queryVariations = generateQueryVariations(processedQuery);
    if (queryVariations.length > 1) {
      console.log(`[LangChain] Generated ${queryVariations.length} query variations`);
    }
    
    const embeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small',
    });

    const vectorStore = await createPostgreSQLVectorStore(userId, embeddings);
    
    // Search with the main query - fetch more results to have better selection
    const mainResults = await vectorStore.similaritySearchWithScore(processedQuery, limit * 3);
    console.log(`[LangChain] Retrieved ${mainResults.length} results for main query`);
    
    // If we have variations and not enough good results, search with variations too
    let allResults = [...mainResults];
    const goodMainResults = mainResults.filter(([, score]) => score >= minSimilarity);
    
    if (queryVariations.length > 1 && goodMainResults.length < limit) {
      // Only search with variations if we need more results
      for (let i = 1; i < queryVariations.length && goodMainResults.length < limit; i++) {
        const variationResults = await vectorStore.similaritySearchWithScore(queryVariations[i], limit * 2);
        console.log(`[LangChain] Retrieved ${variationResults.length} results for variation "${queryVariations[i]}"`);
        allResults = [...allResults, ...variationResults];
      }
    }
    
    // Deduplicate results by document content
    const seenContents = new Set<string>();
    const uniqueResults: Array<[Document, number]> = [];
    
    for (const result of allResults) {
      const contentHash = result[0].pageContent.substring(0, 100); // Use first 100 chars as a simple hash
      if (!seenContents.has(contentHash)) {
        seenContents.add(contentHash);
        uniqueResults.push(result);
      }
    }
    
    console.log(`[LangChain] Deduplicated to ${uniqueResults.length} unique results`);

    // Filter by similarity threshold and format results
    const filteredResults = uniqueResults
      .filter(([, score]) => score >= minSimilarity)
      .sort((a, b) => b[1] - a[1]) // Sort by similarity score
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
    
    // Implement keyword boosting for exact matches
    const boostedResults = boostExactMatches(query, filteredResults);
    
    // For highly relevant results, try to include adjacent chunks for more context
    const enhancedResults = await enhanceWithAdjacentChunks(boostedResults, userId);

    return enhancedResults;
  } catch (error) {
    console.error('[LangChain] Error searching knowledge base:', error);
    throw new Error('Failed to search knowledge base');
  }
}

/**
 * Boost results that contain exact keyword matches
 */
function boostExactMatches(query: string, results: SearchResult[]): SearchResult[] {
  if (!results.length) return results;
  
  // Extract important keywords from the query
  const keywords = extractKeywords(query);
  if (!keywords.length) return results;
  
  console.log(`[LangChain] Boosting results for keywords: ${keywords.join(', ')}`);
  
  // Clone results to avoid modifying the original
  const boostedResults = [...results];
  
  // Calculate boost for each result
  for (const result of boostedResults) {
    let keywordBoost = 0;
    const content = result.content.toLowerCase();
    
    // Check for exact keyword matches
    for (const keyword of keywords) {
      // Skip very short keywords
      if (keyword.length < 4) continue;
      
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(content)) {
        // Boost based on keyword length and position
        const position = content.indexOf(keyword.toLowerCase());
        const positionFactor = position < 100 ? 0.05 : 0.02; // Higher boost for matches at beginning
        keywordBoost += Math.min(0.1, keyword.length * 0.005) + positionFactor;
      }
    }
    
    // Apply boost (max 0.2 to avoid overwhelming semantic similarity)
    if (keywordBoost > 0) {
      const cappedBoost = Math.min(0.2, keywordBoost);
      result.similarity = Math.min(0.99, result.similarity + cappedBoost);
      result.keywordBoost = cappedBoost;
    }
  }
  
  // Re-sort based on boosted similarity
  boostedResults.sort((a, b) => b.similarity - a.similarity);
  
  return boostedResults;
}

/**
 * Extract important keywords from a query
 */
function extractKeywords(query: string): string[] {
  // Remove quotes and special characters
  const cleanQuery = query.replace(/["']/g, '').replace(/[^\w\s]/g, ' ');
  
  // Split into words
  const words = cleanQuery.toLowerCase().split(/\s+/);
  
  // Filter out common words and short words
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'in', 'on', 'at', 'to', 'for', 'with', 'by', 'about', 'like', 'through', 'over', 'before',
    'after', 'since', 'during', 'this', 'that', 'these', 'those', 'they', 'them', 'their',
    'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'all', 'any',
    'both', 'each', 'few', 'more', 'most', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
    'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'should', 'now'
  ]);
  
  return words.filter(word => 
    word.length > 2 && !stopWords.has(word)
  );
}

/**
 * Enhance highly relevant results by including adjacent chunks for more context
 */
async function enhanceWithAdjacentChunks(results: SearchResult[], userId: string): Promise<SearchResult[]> {
  if (!results.length) return results;
  
  // Only enhance results with high similarity scores
  const highRelevanceThreshold = 0.6;
  const enhancedResults: SearchResult[] = [];
  
  for (const result of results) {
    enhancedResults.push(result);
    
    // For highly relevant results, try to get adjacent chunks
    if (result.similarity >= highRelevanceThreshold) {
      try {
        const adjacentChunks = await getAdjacentChunks(
          result.source.documentId, 
          result.source.chunkIndex, 
          userId
        );
        
        // Add adjacent chunks as separate results with lower similarity
        for (const chunk of adjacentChunks) {
          const adjacentResult: SearchResult = {
            id: `${result.id}_adjacent_${chunk.chunkIndex}`,
            content: chunk.content,
            similarity: Math.max(0.1, result.similarity - 0.2), // Lower similarity for context
            source: {
              documentId: result.source.documentId,
              documentTitle: result.source.documentTitle,
              chunkIndex: chunk.chunkIndex,
            },
            metadata: {
              ...result.metadata,
              isAdjacentContext: true,
              originalChunkIndex: result.source.chunkIndex,
            },
          };
          enhancedResults.push(adjacentResult);
        }
      } catch (error) {
        console.warn(`[enhanceWithAdjacentChunks] Failed to get adjacent chunks for ${result.id}:`, error);
      }
    }
  }
  
  // Sort by similarity again and limit to reasonable number
  return enhancedResults
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 20); // Allow more results with context
}

/**
 * Get adjacent chunks from the same document
 */
async function getAdjacentChunks(
  documentId: string, 
  chunkIndex: number, 
  userId: string
): Promise<Array<{ content: string; chunkIndex: number }>> {
  try {
    const allChunks = await getUserDocumentChunks(userId);
    
    // Filter chunks from the same document
    const documentChunks = allChunks
      .filter(chunk => chunk.documentId === documentId)
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
    
    const adjacentChunks: Array<{ content: string; chunkIndex: number }> = [];
    
    // Get previous chunk
    const prevChunk = documentChunks.find(chunk => chunk.chunkIndex === chunkIndex - 1);
    if (prevChunk) {
      adjacentChunks.push({
        content: prevChunk.content,
        chunkIndex: prevChunk.chunkIndex,
      });
    }
    
    // Get next chunk
    const nextChunk = documentChunks.find(chunk => chunk.chunkIndex === chunkIndex + 1);
    if (nextChunk) {
      adjacentChunks.push({
        content: nextChunk.content,
        chunkIndex: nextChunk.chunkIndex,
      });
    }
    
    return adjacentChunks;
  } catch (error) {
    console.error('[getAdjacentChunks] Error:', error);
    return [];
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
export function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
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