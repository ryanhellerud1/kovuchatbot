import { type BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { Document } from '@langchain/core/documents';
import type { z } from 'zod';

/**
 * LangChain message type mapping
 */
export type LangChainMessage = BaseMessage;

/**
 * Convert AI SDK message to LangChain message
 */
export function convertToLangChainMessage(message: any): BaseMessage {
  switch (message.role) {
    case 'user':
      return new HumanMessage(message.content || getTextFromParts(message.parts));
    case 'assistant':
      return new AIMessage(message.content || getTextFromParts(message.parts));
    case 'system':
      return new SystemMessage(message.content || getTextFromParts(message.parts));
    default:
      throw new Error(`Unsupported message role: ${message.role}`);
  }
}

/**
 * Convert LangChain message to AI SDK format
 */
export function convertFromLangChainMessage(message: BaseMessage): any {
  if (message instanceof HumanMessage) {
    return {
      role: 'user',
      content: message.content,
      parts: [{ type: 'text', text: message.content }],
    };
  } else if (message instanceof AIMessage) {
    return {
      role: 'assistant',
      content: message.content,
      parts: [{ type: 'text', text: message.content }],
    };
  } else if (message instanceof SystemMessage) {
    return {
      role: 'system',
      content: message.content,
      parts: [{ type: 'text', text: message.content }],
    };
  }
  
  throw new Error(`Unsupported LangChain message type: ${message.constructor.name}`);
}

/**
 * Extract text content from message parts
 */
function getTextFromParts(parts: any[]): string {
  if (!parts || !Array.isArray(parts)) {
    return '';
  }
  
  return parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join(' ');
}

/**
 * Convert array of messages to LangChain format
 */
export function convertMessagesToLangChain(messages: any[]): BaseMessage[] {
  return messages.map(convertToLangChainMessage);
}

/**
 * Convert array of LangChain messages to AI SDK format
 */
export function convertMessagesFromLangChain(messages: BaseMessage[]): any[] {
  return messages.map(convertFromLangChainMessage);
}

/**
 * LangChain document interface for RAG
 */
export interface LangChainDocument extends Document {
  pageContent: string;
  metadata: {
    documentId: string;
    documentTitle: string;
    chunkIndex: number;
    source?: string;
    [key: string]: any;
  };
}

/**
 * Convert custom document chunk to LangChain document
 */
export function convertToLangChainDocument(chunk: any): LangChainDocument {
  return new Document({
    pageContent: chunk.content,
    metadata: {
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle,
      chunkIndex: chunk.chunkIndex,
      source: chunk.source?.document || chunk.documentTitle,
      ...chunk.metadata,
    },
  }) as LangChainDocument;
}

/**
 * Tool execution context for LangChain tools
 */
export interface LangChainToolContext {
  userId: string;
  sessionId?: string;
  chatId?: string;
  dataStream?: any; // Will be replaced with LangChain streaming
}

/**
 * Base interface for LangChain tool implementations
 */
export interface LangChainToolImplementation {
  name: string;
  description: string;
  schema: z.ZodSchema;
  execute: (input: any, context: LangChainToolContext) => Promise<any>;
}

/**
 * Search result interface for LangChain RAG
 */
export interface LangChainSearchResult {
  document: LangChainDocument;
  score: number;
  relevanceScore?: string;
}

/**
 * RAG retrieval options for LangChain
 */
export interface LangChainRetrievalOptions {
  k?: number; // Number of documents to retrieve
  scoreThreshold?: number; // Minimum similarity score
  filter?: Record<string, any>; // Metadata filters
}

/**
 * Streaming callback interface for LangChain
 */
export interface LangChainStreamingCallbacks {
  onToken?: (token: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Agent execution result
 */
export interface LangChainAgentResult {
  output: string;
  intermediateSteps?: any[];
  toolCalls?: any[];
}

/**
 * Memory interface for conversation context
 */
export interface LangChainMemoryInterface {
  loadMemoryVariables(inputs: Record<string, any>): Promise<Record<string, any>>;
  saveContext(inputs: Record<string, any>, outputs: Record<string, any>): Promise<void>;
  clear(): Promise<void>;
}