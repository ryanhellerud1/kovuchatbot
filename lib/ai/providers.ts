import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from 'ai';
import { xai } from '@ai-sdk/xai';
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

// Define the model identifier constant
const QWEN3_MODEL_NAME = 'qwen/qwen3-32b:free';

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model-reasoning-qwen3': wrapLanguageModel({
          model: openrouter(QWEN3_MODEL_NAME),
          middleware: extractReasoningMiddleware({ tagName: 'think' }),
        }),
      },
    })
  : customProvider({
      languageModels: {
        // Only keep the Qwen3 reasoning model (Kovu AI Deep Think)
        'chat-model-reasoning-qwen3': wrapLanguageModel({
          model: openrouter(QWEN3_MODEL_NAME),
          middleware: extractReasoningMiddleware({ tagName: 'think' }), 
        }),
      },
    });
