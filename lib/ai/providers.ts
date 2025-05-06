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

// Define the model identifier constant (optional but good practice)
const QWEN3_MODEL_NAME = 'qwen/qwen3-32b:free';

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model': chatModel,
        'chat-model-reasoning': reasoningModel,
        'title-model': titleModel,
        'artifact-model': artifactModel,
      },
    })
  : customProvider({
      languageModels: {
        // Existing Grok models
        'chat-model': xai('grok-2-vision-1212'),
        'chat-model-reasoning': wrapLanguageModel({
          model: xai('grok-3-mini-beta'),
          middleware: extractReasoningMiddleware({ tagName: 'think' }),
        }),
        'title-model': xai('grok-2-1212'),
        'artifact-model': xai('grok-2-1212'),
        
        // Qwen3 models using the official OpenRouter provider
        'chat-model-qwen3': openrouter(QWEN3_MODEL_NAME),
        'chat-model-reasoning-qwen3': wrapLanguageModel({
          model: openrouter(QWEN3_MODEL_NAME),
          middleware: extractReasoningMiddleware({ tagName: 'think' }), 
        }),
        'title-model-qwen3': openrouter(QWEN3_MODEL_NAME),
        'artifact-model-qwen3': openrouter(QWEN3_MODEL_NAME),
      },
      imageModels: {
        'small-model': xai.image('grok-2-image'),
      },
    });
