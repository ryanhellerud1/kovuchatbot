'use server';

import { generateText, type UIMessage } from 'ai';
import { cookies } from 'next/headers';
import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
  updateChatVisiblityById,
} from '@/lib/db/queries';
import type { VisibilityType } from '@/components/visibility-selector';
import { myProvider } from '@/lib/ai/providers';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set('chat-model', model);
}

export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}) {
  try {
    const { text: title } = await generateText({
      model: myProvider.languageModel('chat-model-tools'), // Use the OpenAI model that works
      system: `Generate a short title (max 80 characters) based on the user's message. Do not use quotes or colons.`,
      prompt: typeof message.content === 'string' ? message.content : JSON.stringify(message),
    });

    return title;
  } catch (error) {
    console.error('Error generating title:', error);
    // Fallback to a simple title if generation fails
    const content = typeof message.content === 'string' ? message.content : 'New Chat';
    return content.length > 50 ? content.substring(0, 47) + '...' : content;
  }
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const [message] = await getMessageById({ id });

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
  });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  await updateChatVisiblityById({ chatId, visibility });
}
