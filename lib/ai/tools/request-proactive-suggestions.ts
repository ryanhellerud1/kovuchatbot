import { z } from 'zod';
import { DataStreamWriter, streamObject, tool } from 'ai';
import { myProvider } from '../providers'; // Assuming this is the correct path to your provider

interface RequestProactiveSuggestionsProps {
  // session: Session; // Add session if needed for authentication or user-specific suggestions
  dataStream: DataStreamWriter;
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  partialQuery: string;
}

export const requestProactiveSuggestions = ({
  dataStream,
  chatHistory,
  partialQuery,
}: RequestProactiveSuggestionsProps) =>
  tool({
    description: 'Request proactive suggestions based on partial user query and chat history.',
    parameters: z.object({
      chatHistory: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })).describe('The current chat history.'),
      partialQuery: z.string().describe('The user\'s current partial query.'),
    }),
    execute: async ({ chatHistory, partialQuery }) => {
      // Construct a prompt for the AI model
      const prompt = `
        Given the following chat history:
        ${chatHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

        And the user's current partial query:
        "${partialQuery}"

        Please provide a few relevant suggestions to help the user. These could be:
        - Ways to complete the current query.
        - Related questions or topics.
        - Clarifying questions if the query is ambiguous.

        Return the suggestions as an array of strings. Max 3 suggestions.
      `;

      const { elementStream } = streamObject({
        model: myProvider.languageModel('artifact-model'), // Using artifact-model as suggestion-model is not available
        prompt: prompt,
        output: 'array',
        schema: z.string().describe('A proactive suggestion'),
      });

      const suggestions: string[] = [];
      for await (const element of elementStream) {
        // dataStream.writeData({ // Decide if you want to stream suggestions or send all at once
        //   type: 'proactive-suggestion',
        //   content: element,
        // });
        suggestions.push(element);
      }

      // For now, let's just log the suggestions.
      // In a real implementation, you'd send these to the UI.
      console.log('Proactive suggestions:', suggestions);

      return {
        suggestions,
      };
    },
  });

// Example usage (for testing purposes, remove later)
/*
async function main() {
  const mockDataStream: DataStreamWriter = {
    write: (data) => console.log('Streaming data:', data),
    close: () => console.log('Stream closed'),
    flush: async () => console.log('Stream flushed'),
    transform: () => new TransformStream(),
    getWriter: () => ({
        write: (data) => console.log('Writer writing data:', data),
        close: () => console.log('Writer closed'),
        abort: (reason) => console.log('Writer aborted:', reason),
        releaseLock: () => console.log('Writer lock released'),
        desiredSize: null,
        ready: Promise.resolve(undefined),
    })
  };

  const exampleTool = requestProactiveSuggestions({
    dataStream: mockDataStream,
    chatHistory: [
      { role: 'user', content: 'Tell me about Next.js' },
      { role: 'assistant', content: 'Next.js is a React framework for building server-side rendered and static web applications.' },
    ],
    partialQuery: 'How does it handle rout',
  });

  const result = await exampleTool.execute({
    chatHistory: [
      { role: 'user', content: 'Tell me about Next.js' },
      { role: 'assistant', content: 'Next.js is a React framework for building server-side rendered and static web applications.' },
    ],
    partialQuery: 'How does it handle rout',
  });
  console.log('Tool execution result:', result);
}

main().catch(console.error);
*/
