import { customProvider } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { isTestEnvironment } from '../constants';
import { artifactModel, chatModel } from './models.test';

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
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout - connection took too long');
      }
      throw error;
    }
  },
});

// Paid models on OpenRouter (uses your credits, no rate limits)
const CHAT_MODEL = 'google/gemini-2.0-flash-001';  // Fast, cheap ($0.10/1M tokens)
const ARTIFACT_MODEL = 'google/gemini-2.0-flash-001';

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model': chatModel,
        'chat-model-tools': chatModel,
        'artifact-model-qwen3': artifactModel,
        'artifact-model': artifactModel,
      },
      imageModels: {
        'small-model': {
          ...openai.image('dall-e-3'),
          maxImagesPerCall: 1,
        },
      },
    })
  : customProvider({
      languageModels: {
        // Llama 3.3 70B - excellent free model with tool support
        'chat-model-tools': openrouter(CHAT_MODEL),
        // Artifact models for document generation
        'artifact-model-qwen3': openrouter(ARTIFACT_MODEL),
        'artifact-model': openrouter(ARTIFACT_MODEL),
      },
      imageModels: {
        'small-model': {
          ...openai.image('dall-e-3'),
          maxImagesPerCall: 1,
        },
      },
    });
