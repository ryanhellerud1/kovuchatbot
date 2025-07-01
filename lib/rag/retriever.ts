import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { createPostgreSQLVectorStore } from './langchain-vector-store';
import { getUserDocumentChunks, saveKnowledgeDocument, saveDocumentChunk } from '@/lib/db/queries';
import { processDocumentWithLangChain } from './langchain-document-processor';
import { countTokensMultiple } from '@/lib/utils/token-counter';
import { sanitizeTextPreserveFormatting, sanitizeMetadata, logSanitizationStats } from '@/lib/utils/text-sanitizer';
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
  chunkSize: 2400,      // Larger chunks for more context per chunk
  chunkOverlap: 400,    // Significant overlap to maintain context continuity
  embeddingModel: 'text-embedding-3-small',
  similarityThreshold: 0.22, // More conservative threshold to improve result quality
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
      
      // Sanitize text content
      const sanitizedContent = sanitizeTextPreserveFormatting(content);
      if (content !== sanitizedContent) {
        logSanitizationStats(content, sanitizedContent, `${fileType} file`);
      }
      
      return [new Document({
        pageContent: sanitizedContent,
        metadata: sanitizeMetadata({ fileName, fileType, fileSize: file.length })
      })];
    }

    // For binary files, create temporary file for LangChain loaders
    tempFilePath = await createTempFile(file, fileName);
    
    let loader: PDFLoader | DocxLoader;
    
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
    
    // Sanitize and add file metadata to documents
    documents.forEach((doc, index) => {
      // Sanitize document content
      const originalContent = doc.pageContent;
      doc.pageContent = sanitizeTextPreserveFormatting(originalContent);
      
      // Log sanitization if changes were made
      if (originalContent !== doc.pageContent) {
        logSanitizationStats(originalContent, doc.pageContent, `document ${index + 1}`);
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
    
    // Sanitize the full content
    const sanitizedFullContent = sanitizeTextPreserveFormatting(fullContent);
    if (fullContent !== sanitizedFullContent) {
      logSanitizationStats(fullContent, sanitizedFullContent, 'combined document content');
    }

    // Split text using LangChain's text splitter with improved chunking strategy
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: finalConfig.chunkSize,
      chunkOverlap: finalConfig.chunkOverlap,
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
      modelName: finalConfig.embeddingModel,
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
  const fillerWords = /\b(a|an|and|or|but|is|are|was|were|be|been|being|in|on|at|to|for|with|by|about|like|through|over|before|after|since|during)\b/gi;
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
  if (words.length > 2) {
    const keywords = extractKeywords(query);
    if (keywords.length > 1 && keywords.join(' ').toLowerCase() !== query.toLowerCase()) {
      variations.push(keywords.join(' '));
    }
  }

  return [...new Set(variations)]; // Deduplicate
}

export async function searchKnowledgeBase(
  query: string,
  userId: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 25, minSimilarity = 0.22, includeMetadata = true } = options;

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
    
    // Test the vector store connection
    console.log(`[LangChain] Vector store created successfully for user ${userId}`);
    
    const uniqueResults: Array<[Document, number]> = [];
    const seenContents = new Set<string>();

    // Iterate through query variations to gather a diverse set of results
    for (const q of queryVariations) {
      // Stop if we have enough results to satisfy the limit after filtering
      if (uniqueResults.length >= limit) {
        console.log('[LangChain] Sufficient results gathered, stopping further searches.');
        break;
      }
      
      console.log(`[LangChain] Searching with query variation: "${q}"`);
      const variationResults = await vectorStore.similaritySearchWithScore(q, limit * 2);
      console.log(`[LangChain] Retrieved ${variationResults.length} results for variation`);

      for (const result of variationResults) {
        const contentHash = result[0].pageContent.substring(0, 100);
        if (!seenContents.has(contentHash)) {
          seenContents.add(contentHash);
          uniqueResults.push(result);
        }
      }
    }
    
    console.log(`[LangChain] Gathered ${uniqueResults.length} unique results from all query variations.`);

    // Filter by similarity threshold and format results
    const filteredResults = uniqueResults
      .filter(([, score]) => score >= minSimilarity)
      .sort((a, b) => b[1] - a[1]) // Sort by similarity score
      .slice(0, 25)
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
    
    // Add document diversity to ensure results from multiple documents when possible
    const diversifiedResults = diversifyResultsByDocument(boostedResults, limit);
    
    // For highly relevant results, try to include adjacent chunks for more context
    const enhancedResults = await enhanceWithAdjacentChunks(diversifiedResults, userId);

    // Log token usage for the final enhanced results
    if (enhancedResults.length > 0) {
      const resultContents = enhancedResults.map(r => r.content);
      const totalTokens = countTokensMultiple(resultContents);
      const avgTokensPerResult = Math.round(totalTokens / enhancedResults.length);
      console.log(`[LangChain] Enhanced results token usage: ${totalTokens} tokens (avg: ${avgTokensPerResult}/result) for ${enhancedResults.length} results`);
    }

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
      if (keyword.length < 2) continue;
      
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(content)) {
        // Boost based on keyword length and position
        const position = content.indexOf(keyword.toLowerCase());
        const positionFactor = position < 100 ? 0.05 : 0.02; // Higher boost for matches at beginning
        keywordBoost += Math.min(0.1, keyword.length * 0.01) + positionFactor;
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
 * Diversify results to include content from multiple documents when possible
 */
function diversifyResultsByDocument(results: SearchResult[], targetLimit: number): SearchResult[] {
  if (results.length <= targetLimit) return results;
  
  // Group results by document
  const resultsByDocument = new Map<string, SearchResult[]>();
  
  for (const result of results) {
    const docId = result.source.documentId;
    if (!resultsByDocument.has(docId)) {
      resultsByDocument.set(docId, []);
    }
    resultsByDocument.get(docId)?.push(result);
  }
  
  // If we only have one document, return top results
  if (resultsByDocument.size === 1) {
    return results.slice(0, targetLimit);
  }
  
  console.log(`[diversifyResultsByDocument] Found results from ${resultsByDocument.size} documents`);
  
  // Distribute results across documents
  const diversifiedResults: SearchResult[] = [];
  const maxPerDocument = Math.max(1, Math.ceil(targetLimit / resultsByDocument.size));
  
  // First pass: take top results from each document
  for (const [docId, docResults] of resultsByDocument) {
    const topFromDoc = docResults.slice(0, maxPerDocument);
    diversifiedResults.push(...topFromDoc);
  }
  
  // Second pass: fill remaining slots with highest similarity results
  const remainingSlots = targetLimit - diversifiedResults.length;
  if (remainingSlots > 0) {
    const usedIds = new Set(diversifiedResults.map(r => r.id));
    const remainingResults = results
      .filter(r => !usedIds.has(r.id))
      .slice(0, remainingSlots);
    
    diversifiedResults.push(...remainingResults);
  }
  
  // Sort by similarity and return
  return diversifiedResults
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, targetLimit);
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
    'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'should', 'now', 'between'
  ]);
  
  return words.filter(word => 
    word.length > 1 && !stopWords.has(word)
  );
}

/**
 * Enhance highly relevant results by including adjacent chunks for more context
 */
async function enhanceWithAdjacentChunks(results: SearchResult[], userId: string): Promise<SearchResult[]> {
  if (!results.length) return results;

  const contextThreshold = 0.45;
  const enhancedResults: SearchResult[] = [];
  
  // Fetch all user document chunks once to avoid multiple DB calls
  const allUserChunks = await getUserDocumentChunks(userId);

  for (const result of results) {
    enhancedResults.push(result);

    if (result.similarity >= contextThreshold) {
      try {
        const adjacentChunks = getAdjacentChunks(
          result.source.documentId,
          result.source.chunkIndex,
          allUserChunks, // Pass all chunks to the function
          2
        );

        for (const chunk of adjacentChunks) {
          const distance = Math.abs(chunk.chunkIndex - result.source.chunkIndex);
          const contextualSimilarity = Math.max(0.15, result.similarity - (0.1 * distance));

          enhancedResults.push({
            id: `${result.id}_adjacent_${chunk.chunkIndex}`,
            content: chunk.content,
            similarity: contextualSimilarity,
            source: {
              documentId: result.source.documentId,
              documentTitle: result.source.documentTitle,
              chunkIndex: chunk.chunkIndex,
            },
            metadata: {
              ...result.metadata,
              isAdjacentContext: true,
              originalChunkIndex: result.source.chunkIndex,
              contextDistance: distance,
            },
          });
        }
      } catch (error) {
        console.warn(`[enhanceWithAdjacentChunks] Failed to get adjacent chunks for ${result.id}:`, error);
      }
    }
  }

  return enhancedResults
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 30);
}

/**
 * Get adjacent chunks from a pre-fetched list of chunks
 */
function getAdjacentChunks(
  documentId: string,
  chunkIndex: number,
  allChunks: Array<{ documentId: string; chunkIndex: number; content: string }>,
  range = 1
): Array<{ content: string; chunkIndex: number }> {
  const documentChunks = allChunks
    .filter(chunk => chunk.documentId === documentId)
    .sort((a, b) => a.chunkIndex - b.chunkIndex);

  const adjacentChunks: Array<{ content: string; chunkIndex: number }> = [];

  for (let i = 1; i <= range; i++) {
    const prevChunk = documentChunks.find(chunk => chunk.chunkIndex === chunkIndex - i);
    if (prevChunk) adjacentChunks.push(prevChunk);

    const nextChunk = documentChunks.find(chunk => chunk.chunkIndex === chunkIndex + i);
    if (nextChunk) adjacentChunks.push(nextChunk);
  }

  return adjacentChunks;
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
 * Validate file size with blob storage support (max 50MB) (compatible with legacy)
 * @deprecated Use lib/blob-storage.ts utilities instead
 */
export function validateFileSize(
  fileSize: number,
  maxSize: number = 50 * 1024 * 1024, // Increased to 50MB for blob storage
): boolean {
  return fileSize <= maxSize;
}

/**
 * Check if file should use blob storage based on size
 * @deprecated Use lib/blob-storage.ts utilities instead
 */
export function shouldUseBlobStorage(fileSize: number): boolean {
  const blobThreshold = 4.5 * 1024 * 1024; // 4.5MB
  return fileSize > blobThreshold;
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