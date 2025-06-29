import { ChatOpenAI } from '@langchain/openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { isTestEnvironment } from '../constants';

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
 * Create a LangChain OpenAI embeddings instance
 */
export function createLangChainEmbeddings(): OpenAIEmbeddings {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required for LangChain embeddings');
  }

  return new OpenAIEmbeddings({
    modelName: 'text-embedding-3-small',
    openAIApiKey: apiKey,
    dimensions: 1536, // Match current implementation
  });
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