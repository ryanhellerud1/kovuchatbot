export const DEFAULT_CHAT_MODEL: string = 'chat-model-reasoning-qwen3';

export interface ChatModel {
  id: string;
  name: string;
  description: string;
}

export const chatModels: Array<ChatModel> = [
  {
    id: 'chat-model-reasoning-qwen3',
    name: 'Kovu AI Deep Think',
    description: 'Kovu AI with advanced reasoning',
  },
];
