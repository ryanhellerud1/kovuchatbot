import { ChatOpenAI } from '@langchain/openai';
import { HuggingFaceInferenceEmbeddings } from '@langchain/community/embeddings/hf';
import { Embeddings } from '@langchain/core/embeddings';
import { isTestEnvironment } from '../constants';

/**
 * Wrapper class that pads HuggingFace embeddings to 1536 dimensions
 * for compatibility with existing database schema (OpenAI's dimension)
 */
class PaddedHuggingFaceEmbeddings extends Embeddings {
  private hfEmbeddings: HuggingFaceInferenceEmbeddings;
  private targetDimension = 1536;

  constructor() {
    super({});
    this.hfEmbeddings = new HuggingFaceInferenceEmbeddings({
      apiKey: process.env.HUGGING_FACE_API_TOKEN,
      model: 'BAAI/bge-base-en-v1.5', // 768 dimensions, good quality
    });
  }

  private padEmbedding(embedding: number[]): number[] {
    if (embedding.length >= this.targetDimension) {
      return embedding.slice(0, this.targetDimension);
    }
    const padded = new Array(this.targetDimension).fill(0);
    for (let i = 0; i < embedding.length; i++) {
      padded[i] = embedding[i];
    }
    return padded;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const embeddings = await this.hfEmbeddings.embedDocuments(texts);
    return embeddings.map(emb => this.padEmbedding(emb));
  }

  async embedQuery(text: string): Promise<number[]> {
    const embedding = await this.hfEmbeddings.embedQuery(text);
    return this.padEmbedding(embedding);
  }
}

/**
 * LangChain model configuration
 */
export interface LangChainModelConfig {
  id: string;
  name: string;
  description: string;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
}

/**
 * Available LangChain models
 */
export const langchainModels: LangChainModelConfig[] = [
  {
    id: 'langchain-gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo (LangChain)',
    description: 'OpenAI GPT-3.5 Turbo via LangChain with tool support',
    modelName: 'gpt-3.5-turbo',
    temperature: 0.7,
    maxTokens: 4096,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'langchain-gpt-4',
    name: 'GPT-4 (LangChain)',
    description: 'OpenAI GPT-4 via LangChain with advanced reasoning',
    modelName: 'gpt-4',
    temperature: 0.7,
    maxTokens: 8192,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'langchain-gpt-4-turbo',
    name: 'GPT-4 Turbo (LangChain)',
    description: 'OpenAI GPT-4 Turbo via LangChain with enhanced capabilities',
    modelName: 'gpt-4-turbo-preview',
    temperature: 0.7,
    maxTokens: 4096,
    supportsTools: true,
    supportsStreaming: true,
  },
];

/**
 * Create a LangChain ChatOpenAI instance
 */
export function createLangChainChatModel(config: LangChainModelConfig): ChatOpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required for LangChain models');
  }

  return new ChatOpenAI({
    modelName: config.modelName,
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens,
    openAIApiKey: apiKey,
    streaming: config.supportsStreaming ?? true,
    verbose: !isTestEnvironment,
  });
}

/**
 * Create a LangChain embeddings instance (using free HuggingFace)
 */
export function createLangChainEmbeddings(): Embeddings {
  const apiKey = process.env.HUGGING_FACE_API_TOKEN;

  if (!apiKey) {
    throw new Error('HUGGING_FACE_API_TOKEN environment variable is required for embeddings');
  }

  return new PaddedHuggingFaceEmbeddings();
}

/**
 * Get LangChain model by ID
 */
export function getLangChainModel(modelId: string): ChatOpenAI {
  const config = langchainModels.find(model => model.id === modelId);
  
  if (!config) {
    throw new Error(`LangChain model not found: ${modelId}`);
  }
  
  return createLangChainChatModel(config);
}

/**
 * Check if a model ID is a LangChain model
 */
export function isLangChainModel(modelId: string): boolean {
  return langchainModels.some(model => model.id === modelId);
}

/**
 * Get available LangChain model IDs
 */
export function getLangChainModelIds(): string[] {
  return langchainModels.map(model => model.id);
}

/**
 * Validate LangChain environment variables
 */
export function validateLangChainEnvironment(): {
  isValid: boolean;
  missingVars: string[];
  errors: string[];
} {
  const missingVars: string[] = [];
  const errors: string[] = [];

  // Check required environment variables
  if (!process.env.OPENAI_API_KEY) {
    missingVars.push('OPENAI_API_KEY');
  }

  // Test API key format (should start with 'sk-')
  if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith('sk-')) {
    errors.push('OPENAI_API_KEY appears to be invalid (should start with "sk-")');
  }

  return {
    isValid: missingVars.length === 0 && errors.length === 0,
    missingVars,
    errors,
  };
}

/**
 * Default LangChain model for testing
 */
export const DEFAULT_LANGCHAIN_MODEL = 'langchain-gpt-3.5-turbo';

/**
 * Test model configuration for development
 */
export const TEST_LANGCHAIN_CONFIG: LangChainModelConfig = {
  id: 'langchain-test',
  name: 'Test Model (LangChain)',
  description: 'Test configuration for LangChain development',
  modelName: 'gpt-3.5-turbo',
  temperature: 0.1,
  maxTokens: 1000,
  supportsTools: true,
  supportsStreaming: true,
};