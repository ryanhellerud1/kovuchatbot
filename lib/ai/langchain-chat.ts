import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createOpenAIFunctionsAgent } from 'langchain/agents';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { BaseMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { 
  getLangChainModel, 
  isLangChainModel,
  validateLangChainEnvironment 
} from './langchain-providers';
import { 
  convertToLangChainMessage, 
  convertFromLangChainMessage,
  LangChainToolContext 
} from './langchain-types';
import { 
  withLangChainErrorHandling, 
  withLangChainTiming,
  LangChainError 
} from './langchain-utils';
import { createLangChainSearchKnowledgeTool } from './langchain-tools/search-knowledge';

/**
 * LangChain chat configuration
 */
export interface LangChainChatConfig {
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  enableTools?: boolean;
  streaming?: boolean;
}

/**
 * LangChain chat response
 */
export interface LangChainChatResponse {
  content: string;
  toolCalls?: any[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * LangChain chat implementation
 */
export class LangChainChat {
  private model: ChatOpenAI;
  private tools: StructuredTool[] = [];
  private agent?: AgentExecutor;

  constructor(private config: LangChainChatConfig, private context: LangChainToolContext) {
    // Validate environment
    const envValidation = validateLangChainEnvironment();
    if (!envValidation.isValid) {
      throw new LangChainError(
        `LangChain environment validation failed: ${envValidation.errors.join(', ')}`,
        'initialization'
      );
    }

    // Validate model
    if (!isLangChainModel(config.modelId)) {
      throw new LangChainError(
        `Invalid LangChain model: ${config.modelId}`,
        'initialization'
      );
    }

    // Initialize model
    this.model = getLangChainModel(config.modelId);
    
    // Configure model parameters
    if (config.temperature !== undefined) {
      this.model.temperature = config.temperature;
    }
    if (config.maxTokens !== undefined) {
      this.model.maxTokens = config.maxTokens;
    }

    // Initialize tools if enabled
    if (config.enableTools) {
      this.initializeTools();
    }
  }

  /**
   * Initialize available tools
   */
  private initializeTools(): void {
    this.tools = [
      createLangChainSearchKnowledgeTool(this.context),
      // Add more LangChain tools here as they're migrated
    ];

    console.log(`[LangChain] Initialized ${this.tools.length} tools`);
  }

  /**
   * Initialize agent for tool-enabled conversations
   */
  private async initializeAgent(): Promise<void> {
    if (this.tools.length === 0) {
      return;
    }

    const prompt = ChatPromptTemplate.fromMessages([
      ['system', this.config.systemPrompt || 'You are a helpful AI assistant.'],
      new MessagesPlaceholder('chat_history'),
      ['human', '{input}'],
      new MessagesPlaceholder('agent_scratchpad'),
    ]);

    const agent = await createOpenAIFunctionsAgent({
      llm: this.model,
      tools: this.tools,
      prompt,
    });

    this.agent = new AgentExecutor({
      agent,
      tools: this.tools,
      verbose: process.env.NODE_ENV === 'development',
      maxIterations: 5,
    });

    console.log('[LangChain] Agent initialized with tools');
  }

  /**
   * Generate a chat response
   */
  async generateResponse(
    messages: any[],
    options: {
      streaming?: boolean;
      onToken?: (token: string) => void;
    } = {}
  ): Promise<LangChainChatResponse> {
    return withLangChainErrorHandling('generateResponse', async () => {
      return withLangChainTiming('generateResponse', async () => {
        // Convert messages to LangChain format
        const langchainMessages = messages.map(convertToLangChainMessage);
        
        if (this.config.enableTools && this.tools.length > 0) {
          return this.generateAgentResponse(langchainMessages, options);
        } else {
          return this.generateSimpleResponse(langchainMessages, options);
        }
      });
    });
  }

  /**
   * Generate response using agent (with tools)
   */
  private async generateAgentResponse(
    messages: BaseMessage[],
    options: { streaming?: boolean; onToken?: (token: string) => void }
  ): Promise<LangChainChatResponse> {
    if (!this.agent) {
      await this.initializeAgent();
    }

    if (!this.agent) {
      throw new LangChainError('Failed to initialize agent', 'generateAgentResponse');
    }

    // Extract the latest human message as input
    const humanMessages = messages.filter(msg => msg._getType() === 'human');
    const latestInput = humanMessages[humanMessages.length - 1]?.content || '';

    // Get chat history (all messages except the latest)
    const chatHistory = messages.slice(0, -1);

    const result = await this.agent.invoke({
      input: latestInput,
      chat_history: chatHistory,
    });

    return {
      content: result.output,
      toolCalls: result.intermediateSteps?.map(step => ({
        tool: step.action?.tool,
        input: step.action?.toolInput,
        output: step.observation,
      })),
    };
  }

  /**
   * Generate simple response (without tools)
   */
  private async generateSimpleResponse(
    messages: BaseMessage[],
    options: { streaming?: boolean; onToken?: (token: string) => void }
  ): Promise<LangChainChatResponse> {
    if (options.streaming && options.onToken) {
      // Streaming response
      const stream = await this.model.stream(messages);
      let content = '';
      
      for await (const chunk of stream) {
        const token = chunk.content;
        if (typeof token === 'string') {
          content += token;
          options.onToken(token);
        }
      }
      
      return { content };
    } else {
      // Non-streaming response
      const response = await this.model.invoke(messages);
      return {
        content: response.content as string,
        usage: response.response_metadata?.tokenUsage,
      };
    }
  }

  /**
   * Get available tools
   */
  getAvailableTools(): string[] {
    return this.tools.map(tool => tool.name);
  }

  /**
   * Check if model supports streaming
   */
  supportsStreaming(): boolean {
    return true; // LangChain ChatOpenAI supports streaming
  }

  /**
   * Check if model supports tools
   */
  supportsTools(): boolean {
    return this.config.enableTools === true;
  }
}

/**
 * Factory function to create LangChain chat instance
 */
export function createLangChainChat(
  config: LangChainChatConfig,
  context: LangChainToolContext
): LangChainChat {
  return new LangChainChat(config, context);
}

/**
 * Helper function to check if a model should use LangChain
 */
export function shouldUseLangChainForChat(modelId: string): boolean {
  return isLangChainModel(modelId) && process.env.LANGCHAIN_ENABLED === 'true';
}