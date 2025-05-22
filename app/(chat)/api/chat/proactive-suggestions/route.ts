import { auth } from '@/app/(auth)/auth'; // Assuming auth setup
import { requestProactiveSuggestions } from '@/lib/ai/tools/request-proactive-suggestions';
import { NextRequest, NextResponse } from 'next/server';
import { DataStreamWriter } from 'ai'; // Import if direct tool usage requires it, or adapt

// This is a simplified mock for DataStreamWriter if we are not streaming back to client from this specific endpoint
// For a real implementation, you might use the actual Vercel AI SDK DataStreamWriter or similar.
const mockDataStream: DataStreamWriter = {
  write: (data) => {
    // In a real scenario, this might do something or nothing if not streaming
    // console.log('DataStreamWriter.write called with:', data);
  },
  close: () => {
    // console.log('DataStreamWriter.close called');
  },
  flush: async () => {
    // console.log('DataStreamWriter.flush called');
  },
  transform: () => new TransformStream(), // Basic TransformStream
  getWriter: () => {
    let closed = false;
    return {
      write: (data) => {
        if (closed) return Promise.resolve();
        // console.log('Mocked DataStreamWriter internal writer.write:', data);
        return Promise.resolve();
      },
      close: () => {
        closed = true;
        // console.log('Mocked DataStreamWriter internal writer.close');
        return Promise.resolve();
      },
      abort: (reason) => {
        closed = true;
        // console.log('Mocked DataStreamWriter internal writer.abort:', reason);
        return Promise.resolve();
      },
      releaseLock: () => {
        // console.log('Mocked DataStreamWriter internal writer.releaseLock');
      },
      desiredSize: null,
      ready: Promise.resolve(undefined),
    };
  }
};


export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { partialQuery, chatHistory } = body;

    if (!partialQuery || !Array.isArray(chatHistory)) {
      return NextResponse.json({ error: 'Missing partialQuery or chatHistory' }, { status: 400 });
    }

    // Here, we're directly calling the tool's execute method.
    // The `requestProactiveSuggestions` tool is designed to be used with the AI SDK,
    // which manages the stream and tool execution.
    // For this direct API call, we pass a mock DataStreamWriter if the tool expects one,
    // or we might need to refactor the tool if it's tightly coupled with streaming back to the client.

    const toolInstance = requestProactiveSuggestions({
      dataStream: mockDataStream, // Pass the mock or a real one if needed
      chatHistory: chatHistory, // Already in the right format from client
      partialQuery: partialQuery,
      // session: session, // Add if your tool needs session
    });

    // Directly execute the tool's logic
    const result = await toolInstance.execute({
      chatHistory: chatHistory,
      partialQuery: partialQuery,
    });

    if (result && result.suggestions) {
      return NextResponse.json({ suggestions: result.suggestions }, { status: 200 });
    } else {
      // This case might mean the tool executed but didn't return suggestions,
      // or there was an issue within the tool's execution that didn't throw an error.
      console.error('Proactive suggestions tool executed but returned no suggestions or an unexpected result:', result);
      return NextResponse.json({ suggestions: [] }, { status: 200 }); // Return empty array if no suggestions
    }

  } catch (error) {
    console.error('Error in proactive suggestions API:', error);
    // Check if error is an instance of Error to safely access message property
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
