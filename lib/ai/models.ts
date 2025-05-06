export const DEFAULT_CHAT_MODEL: string = 'chat-model-reasoning-qwen3';

export interface ChatModel {
  id: string;
  name: string;
  description: string;
}

export const chatModels: Array<ChatModel> = [
  {
    id: 'chat-model',
    name: 'Chat model',
    description: 'Primary model for all-purpose chat',
  },
  {
    id: 'chat-model-reasoning',
    name: 'Reasoning model',
    description: 'Uses reasoning model',
  },
  // {
  //   id: 'chat-model-qwen3',
  //   name: 'Qwen3 Chat',
  //   description: 'Qwen3 model for chat',
  // },
  {
    id: 'chat-model-reasoning-qwen3',
    name: 'Kovu AI Deep Think',
    description: 'Kovu AI with advanced reasoning',
  },
  // {
  //   id: 'title-model-qwen3',
  //   name: 'Qwen3 Title',
  //   description: 'Qwen3 model for title generation',
  // },
  // {
  //   id: 'artifact-model-qwen3',
  //   name: 'Qwen3 Artifact',
  //   description: 'Qwen3 model for artifact generation',
  // },
];
