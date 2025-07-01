export const DEFAULT_CHAT_MODEL: string = 'chat-model-tools';

export interface ChatModel {
  id: string;
  name: string;
  description: string;
}

export const chatModels: Array<ChatModel> = [
  // {
  //   id: 'chat-model-reasoning-qwen3',
  //   name: 'Kovu AI Deep Think',
  //   description: 'Kovu AI with advanced reasoning',
  // },
  {
    id: 'chat-model-tools',
    name: 'KovuAI',
    description: 'KovuAI with knowledge search and tool capabilities',
  },
  // LangChain models (experimental)
  {
    id: 'langchain-gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo (LangChain)',
    description: 'OpenAI GPT-3.5 Turbo via LangChain with tool support',
  },
  {
    id: 'langchain-gpt-4',
    name: 'GPT-4 (LangChain)',
    description: 'OpenAI GPT-4 via LangChain with advanced reasoning',
  },
];
