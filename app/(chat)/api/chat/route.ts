import {
  appendClientMessage,
  appendResponseMessages,
  createDataStreamResponse,
  smoothStream,
  streamText,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from 'ai';
import { auth, type UserType } from '@/app/(auth)/auth';
import { type RequestHints, systemPrompt } from '@/lib/ai/prompts';
import {
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { generateUUID, getTrailingMessageId } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';
import { searchKnowledge } from '@/lib/ai/tools/search-knowledge';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { geolocation } from '@vercel/functions';

export const maxDuration = 60;

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    requestBody = postRequestBodySchema.parse(await request.json());
  } catch (error) {
    return new Response('Invalid request body', { status: 400 });
  }

  const { id, message, selectedChatModel } = requestBody;
  if (!selectedChatModel || !['chat-model-tools'].includes(selectedChatModel)) {
    return new Response('Invalid model selected', { status: 400 });
  }

  try {
    const session = await auth();

    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const userType: UserType = session.user.type;
    // Skip message count check since we only have one model
    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new Response(
        'You have exceeded your maximum number of messages for the day! Please try again later.',
        {
          status: 429,
        },
      );
    }

    const chat = await getChatById({ id });

    if (!chat) {
      const title = await generateTitleFromUserMessage({
        message,
      });

      await saveChat({ id, userId: session.user.id, title });
    } else {
      if (chat.userId !== session.user.id) {
        return new Response('Forbidden', { status: 403 });
      }
    }

    const previousMessages = await getMessagesByChatId({ id });

    const messages = appendClientMessage({
      // @ts-expect-error: todo add type conversion from DBMessage[] to UIMessage[]
      messages: previousMessages,
      message,
    });

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    await saveMessages({
      messages: [
        {
          chatId: id,
          id: message.id,
          role: 'user',
          parts: message.parts,
          attachments: message.experimental_attachments ?? [],
          createdAt: new Date(),
        },
      ],
    });

    console.log('[API Route] System Prompt:', systemPrompt({ 
      selectedChatModel, 
      requestHints,
      customPrompt: requestBody.customPrompt 
    }));
    console.log('[API Route] Messages:', JSON.stringify(messages, null, 2));

    return createDataStreamResponse({
      execute: async (dataStream) => {
        const streamTextConfig = {
          model: myProvider.languageModel(selectedChatModel),
          system: systemPrompt({ 
            selectedChatModel, 
            requestHints,
            customPrompt: requestBody.customPrompt 
          }),
          messages,
          maxSteps: 10,
          ...(selectedChatModel === 'chat-model-tools' && {
            tools: {
              createDocument: createDocument({ session, dataStream }),
              updateDocument: updateDocument({ session, dataStream }),
              requestSuggestions: requestSuggestions({ session, dataStream }),
              getWeather: getWeather,
              searchKnowledge: searchKnowledge({ session }),
            },
          }),
          experimental_transform: smoothStream({ chunking: 'word' }),
          experimental_generateMessageId: generateUUID,
          onFinish: (async (event) => {
            if (session.user?.id) {
              try {
                const assistantId = getTrailingMessageId({
                  messages: event.response.messages.filter(
                    (message) => message.role === 'assistant',
                  ),
                });

                if (!assistantId) {
                  console.error('[API Route] No assistant message found in response');
                  throw new Error('No assistant message found!');
                }

                const [, assistantMessage] = appendResponseMessages({
                  messages: [message],
                  responseMessages: event.response.messages,
                });

                console.log('[API Route] Saving assistant message:', assistantMessage);

                await saveMessages({
                  messages: [
                    {
                      id: assistantId,
                      chatId: id,
                      role: assistantMessage.role,
                      parts: assistantMessage.parts || [],
                      attachments:
                        assistantMessage.experimental_attachments ?? [],
                      createdAt: new Date(),
                    },
                  ],
                });
              } catch (error) {
                console.error('[API Route] Failed to save chat:', error);
              }
            }
          }) as StreamTextOnFinishCallback<ToolSet>,
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: 'stream-text',
          },
        };
        
        console.log('[API Route] streamTextConfig:', JSON.stringify(streamTextConfig, null, 2));
        
        let retryCount = 0;
        const maxRetries = 2;
        
        while (retryCount <= maxRetries) {
          try {
            console.log(`[API Route] Attempting streamText call (attempt ${retryCount + 1}/${maxRetries + 1})`);
            const result = streamText(streamTextConfig);
            console.log('[API Route] streamText call succeeded. Result object:', result);

            console.log('[API Route] Merging stream into dataStream...');
            await result.mergeIntoDataStream(dataStream, {
              sendReasoning: false, // No reasoning model available
            });
            console.log('[API Route] Stream merging finished successfully.');
            break; // Success, exit retry loop
            
          } catch (error) {
            console.error(`[API Route] Error on attempt ${retryCount + 1}:`, error);
            
            // Check if it's a connection reset or timeout error
            const isConnectionError = error.message?.includes('ECONNRESET') || 
                                    error.message?.includes('timeout') ||
                                    error.message?.includes('terminated') ||
                                    error.name === 'AbortError';
            
            if (isConnectionError && retryCount < maxRetries) {
              retryCount++;
              console.log(`[API Route] Connection error detected, retrying in ${retryCount * 1000}ms...`);
              await new Promise(resolve => setTimeout(resolve, retryCount * 1000));
              continue;
            }
            
            // If not a connection error or we've exhausted retries, throw the error
            console.error('[API Route] Final error after retries:', error);
            throw error;
          }
        }
      },
      onError: (error) => {
        console.error('[API Route] DataStream Error:', error);
        
        // Provide more specific error messages based on error type
        if (error.message?.includes('ECONNRESET')) {
          return 'Connection was reset while processing your request. Please try again.';
        } else if (error.message?.includes('timeout')) {
          return 'Request timed out. Please try again with a shorter message.';
        } else if (error.message?.includes('terminated')) {
          return 'Stream was terminated unexpectedly. Please try again.';
        }
        
        return 'An error occurred while processing your request. Please try again.';
      },
    });
  } catch (_) {
    console.error('[API Route] General POST Error:', _);
    return new Response('An error occurred while processing your request!', {
      status: 500,
    });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Not Found', { status: 404 });
  }

  const session = await auth();

  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const chat = await getChatById({ id });

    if (chat.userId !== session.user.id) {
      return new Response('Forbidden', { status: 403 });
    }

    const deletedChat = await deleteChatById({ id });

    return Response.json(deletedChat, { status: 200 });
  } catch (error) {
    return new Response('An error occurred while processing your request!', {
      status: 500,
    });
  }
}
