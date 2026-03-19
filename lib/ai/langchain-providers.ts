import { ChatOpenAI } from '@langchain/openai';
import { Embeddings } from '@langchain/core/embeddings';
import { isTestEnvironment } from '../constants';

/**
 * Voyage AI embeddings using voyage-code-2
 * Outputs 1536 dimensions natively - matches database schema exactly
 * Free tier: 50M tokens
 */
class VoyageEmbeddings extends Embeddings {
  private apiKey: string;

  constructor() {
    super({});
    this.apiKey = process.env.VOYAGE_API_KEY || '';
  }

  private async callVoyageAPI(texts: string[], inputType: 'document' | 'query'): Promise<number[][]> {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'voyage-code-2',
        input: texts,
        input_type: inputType,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Voyage AI embedding error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((item: any) => item.embedding);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    const batchSize = 128;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await this.callVoyageAPI(batch, 'document');
      results.push(...embeddings);
    }

    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const embeddings = await this.callVoyageAPI([text], 'query');
    return embeddings[0];
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
 * Create a LangChain embeddings instance (using Voyage AI)
 */
export function createLangChainEmbeddings(): Embeddings {
  const apiKey = process.env.VOYAGE_API_KEY;

  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY environment variable is required for embeddings');
  }

  return new VoyageEmbeddings();
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