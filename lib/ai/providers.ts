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
});

// Define the model identifier constants
const QWEN3_MODEL_NAME = 'qwen/qwen3-32b:free';
const TOOLS_MODEL_NAME = 'gpt-3.5-turbo'; // OpenAI model for tools

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model-reasoning-qwen3': wrapLanguageModel({
          model: openrouter(QWEN3_MODEL_NAME),
          middleware: extractReasoningMiddleware({ tagName: 'think' }),
        }),
        'chat-model-tools': openai(TOOLS_MODEL_NAME),
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
      },
    });
