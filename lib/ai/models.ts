export const DEFAULT_CHAT_MODEL: string = 'chat-model-tools';

export interface ChatModel {
  id: string;
  name: string;
  description: string;
}

export const chatModels: Array<ChatModel> = [
  {
    id: 'chat-model-tools',
    name: 'KovuAI',
    description: 'KovuAI with knowledge search and tool capabilities',
  },
];
