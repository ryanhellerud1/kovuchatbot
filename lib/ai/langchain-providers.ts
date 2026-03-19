import { ChatOpenAI } from '@langchain/openai';
import { Embeddings } from '@langchain/core/embeddings';
import { isTestEnvironment } from '../constants';

/**
 * Jina AI embeddings using jina-embeddings-v3
 * 1024 dimensions padded to 1536 for database compatibility
 * Free tier: 1M tokens, 100 RPM, no credit card required
 */
class JinaEmbeddings extends Embeddings {
  private apiKey: string;
  private targetDimension = 1536;
  private nativeDimension = 1024;

  constructor() {
    super({});
    this.apiKey = process.env.JINA_API_KEY || '';
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

  private async callJinaAPI(texts: string[], task: 'retrieval.passage' | 'retrieval.query'): Promise<number[][]> {
    const response = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'jina-embeddings-v3',
        input: texts,
        dimensions: this.nativeDimension,
        task,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jina embedding error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((item: any) => item.embedding);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    const batchSize = 100;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await this.callJinaAPI(batch, 'retrieval.passage');
      results.push(...embeddings.map(emb => this.padEmbedding(emb)));
    }

    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const embeddings = await this.callJinaAPI([text], 'retrieval.query');
    return this.padEmbedding(embeddings[0]);
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
 * Create a LangChain embeddings instance (using Jina AI)
 */
export function createLangChainEmbeddings(): Embeddings {
  const apiKey = process.env.JINA_API_KEY;

  if (!apiKey) {
    throw new Error('JINA_API_KEY environment variable is required for embeddings');
  }

  return new JinaEmbeddings();
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