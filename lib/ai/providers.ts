import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from 'ai';
import { xai } from '@ai-sdk/xai';
import { openai } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { isTestEnvironment } from '../constants';
import {
  artifactModel,
  chatModel,
  reasoningModel,
  titleModel,
} from './models.test';

// Define the OpenRouter instance using the official provider
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  // Add timeout and retry configuration
  fetch: async (url, options) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout - connection took too long');
      }
      throw error;
    }
  },
});

// Define the model identifier constants
const QWEN3_MODEL_NAME = 'qwen/qwen3-32b:free';
const TOOLS_MODEL_NAME = 'gpt-3.5-turbo'; // OpenAI model for tools

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model-reasoning-qwen3': wrapLanguageModel({
          model: reasoningModel,
          middleware: extractReasoningMiddleware({ tagName: 'think' }),
        }),
        'chat-model-tools': chatModel,
        // Artifact models for document generation
        'artifact-model-qwen3': artifactModel, // Use mock artifact model for tests
        'artifact-model': artifactModel, // Use mock artifact model for tests
      },
      imageModels: {
        'small-model': openai('dall-e-3'), // Use DALL-E for image generation (even in tests)
      },
    })
  : customProvider({
      languageModels: {
        // Qwen3 reasoning model (Kovu AI Deep Think) - no tools
        'chat-model-reasoning-qwen3': wrapLanguageModel({
          model: openrouter(QWEN3_MODEL_NAME),
          middleware: extractReasoningMiddleware({ tagName: 'think' }), 
        }),
        // OpenAI model with tool support
        'chat-model-tools': openai(TOOLS_MODEL_NAME),
        // Artifact models for document generation
        'artifact-model-qwen3': openrouter(QWEN3_MODEL_NAME), // Use Qwen3 for artifacts
        'artifact-model': openai(TOOLS_MODEL_NAME), // Fallback to OpenAI for sheets
      },
      imageModels: {
        'small-model': openai('dall-e-3'), // Use DALL-E for image generation
      },
    });
