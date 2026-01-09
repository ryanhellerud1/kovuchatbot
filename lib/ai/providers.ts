import { google } from '@ai-sdk/google';
import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from 'ai';
import { openai } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { isTestEnvironment } from '../constants';
import { artifactModel, chatModel, reasoningModel } from './models.test';

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

// Define the model identifier constants
const QWEN3_MODEL_NAME = 'qwen/qwen3-32b:free';
const TOOLS_MODEL_NAME = 'gemini-2.0-flash'; // Stable, free Google model

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        // 'chat-model-reasoning-qwen3': wrapLanguageModel({
        //   model: reasoningModel,
        //   middleware: extractReasoningMiddleware({ tagName: 'think' }),
        // }),
        'chat-model': chatModel, // Add for test compatibility
        'chat-model-tools': chatModel,
        // Artifact models for document generation
        'artifact-model-qwen3': artifactModel, // Use mock artifact model for tests
        'artifact-model': artifactModel, // Use mock artifact model for tests
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
        // Qwen3 reasoning model (Kovu AI Deep Think) - no tools
        // 'chat-model-reasoning-qwen3': wrapLanguageModel({
        //   model: openrouter(QWEN3_MODEL_NAME),
        //   middleware: extractReasoningMiddleware({ tagName: 'think' }),
        // }),
        // Google Gemini model with tool support and error handling
        'chat-model-tools': (() => {
          try {
            return google(TOOLS_MODEL_NAME);
          } catch (error: unknown) {
            const message =
              error instanceof Error ? error.message : String(error);
            console.error('Failed to initialize Gemini model:', message);
            // Fallback to stable model
            return google('models/gemini-1.5-flash');
          }
        })(),
        // Artifact models for document generation
        'artifact-model-qwen3': openrouter(QWEN3_MODEL_NAME), // Use Qwen3 for artifacts
        'artifact-model': openrouter(QWEN3_MODEL_NAME), // Use Qwen3 for artifacts (free)
      },
      imageModels: {
        'small-model': {
          ...openai.image('dall-e-3'),
          maxImagesPerCall: 1,
        },
      },
    });
