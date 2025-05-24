import { DataStreamWriter, streamObject as originalStreamObject, tool } from 'ai';
import { myProvider as actualMyProvider } from '../providers'; // Import the actual provider to mock its parts
import { requestProactiveSuggestions } from './request-proactive-suggestions';
import { z } from 'zod';

// Mock '../providers'
jest.mock('../providers', () => ({
  myProvider: {
    languageModel: jest.fn(), // This will be further defined in tests or beforeEach
  },
}));

// Mock 'ai' package for streamObject
jest.mock('ai', () => {
  const originalModule = jest.requireActual('ai');
  return {
    ...originalModule,
    streamObject: jest.fn(), // Mock streamObject
  };
});

// Typedef for the mocked streamObject
const mockedStreamObject = originalStreamObject as jest.Mock;
const mockedLanguageModel = actualMyProvider.languageModel as jest.Mock; // type assertion

const mockDataStream: DataStreamWriter = {
  write: jest.fn(),
  close: jest.fn(),
  flush: jest.fn().mockResolvedValue(undefined),
  transform: jest.fn().mockReturnValue(new TransformStream()),
  getWriter: jest.fn().mockReturnValue({
    write: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    abort: jest.fn().mockResolvedValue(undefined),
    releaseLock: jest.fn(),
    desiredSize: null,
    ready: Promise.resolve(undefined),
  }),
};

describe('requestProactiveSuggestions', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockedStreamObject.mockReset();
    mockedLanguageModel.mockReset();
    // Mock the default return value for languageModel if needed for all tests, or specify in each test
    mockedLanguageModel.mockReturnValue({ /* mock model's methods if any, e.g., if it's a function itself */ });
  });

  // Test 1: Successful suggestion generation
  test('should return suggestions when AI provides them', async () => {
    const chatHistory = [
      { role: 'user' as const, content: 'Tell me about Next.js' },
      { role: 'assistant' as const, content: 'Next.js is a React framework.' },
    ];
    const partialQuery = 'How about routing';
    const expectedSuggestions = ['Dynamic routing in Next.js', 'Next.js App Router vs Pages Router'];

    mockedLanguageModel.mockReturnValue({ /* your mock language model object/functionality */ });
    mockedStreamObject.mockReturnValue({
      elementStream: (async function* () {
        for (const suggestion of expectedSuggestions) {
          yield suggestion;
        }
      })(),
    });

    const toolInstance = requestProactiveSuggestions({
      dataStream: mockDataStream,
      chatHistory,
      partialQuery,
    });

    const result = await toolInstance.execute({ chatHistory, partialQuery });

    expect(mockedLanguageModel).toHaveBeenCalledWith('artifact-model'); // or 'suggestion-model' if that was intended/available
    expect(mockedStreamObject).toHaveBeenCalledTimes(1);
    expect(mockedStreamObject.mock.calls[0][0].prompt).toContain(partialQuery);
    chatHistory.forEach(msg => {
      expect(mockedStreamObject.mock.calls[0][0].prompt).toContain(msg.content);
    });
    expect(result.suggestions).toEqual(expectedSuggestions);
  });

  // Test 2: Handles empty partial query
  test('should correctly form a prompt when partialQuery is empty', async () => {
    const chatHistory = [{ role: 'user' as const, content: 'Hello' }];
    const partialQuery = ''; // Empty query
    const expectedSuggestionsFromAI = ['General greeting response'];


    mockedStreamObject.mockReturnValue({
      elementStream: (async function* () {
        for (const suggestion of expectedSuggestionsFromAI) {
          yield suggestion;
        }
      })(),
    });

    const toolInstance = requestProactiveSuggestions({
      dataStream: mockDataStream,
      chatHistory,
      partialQuery,
    });

    await toolInstance.execute({ chatHistory, partialQuery });

    expect(mockedStreamObject).toHaveBeenCalledTimes(1);
    // Check that the prompt includes the (empty) partial query indicator
    expect(mockedStreamObject.mock.calls[0][0].prompt).toContain('And the user\'s current partial query:\n        ""');
    chatHistory.forEach(msg => {
      expect(mockedStreamObject.mock.calls[0][0].prompt).toContain(msg.content);
    });
  });

  // Test 3: Handles empty chat history
  test('should correctly form a prompt when chatHistory is empty', async () => {
    const chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []; // Empty history
    const partialQuery = 'First question';
    const expectedSuggestionsFromAI = ['How to start a conversation?'];

    mockedStreamObject.mockReturnValue({
      elementStream: (async function* () {
        for (const suggestion of expectedSuggestionsFromAI) {
          yield suggestion;
        }
      })(),
    });

    const toolInstance = requestProactiveSuggestions({
      dataStream: mockDataStream,
      chatHistory,
      partialQuery,
    });

    await toolInstance.execute({ chatHistory, partialQuery });

    expect(mockedStreamObject).toHaveBeenCalledTimes(1);
    expect(mockedStreamObject.mock.calls[0][0].prompt).toContain(partialQuery);
    // Check how empty history is represented in the prompt.
    // The implementation uses chatHistory.map(...).join('\n'), which results in an empty string for an empty array.
    expect(mockedStreamObject.mock.calls[0][0].prompt).toMatch(/Given the following chat history:\s*\n\s*And the user's current partial query:/);
  });

  // Test 4: AI returns no suggestions
  test('should return an empty array if AI provides no suggestions', async () => {
    const chatHistory = [{ role: 'user' as const, content: 'Any ideas?' }];
    const partialQuery = 'For my project';

    mockedStreamObject.mockReturnValue({
      elementStream: (async function* () {
        // Yield nothing
      })(),
    });

    const toolInstance = requestProactiveSuggestions({
      dataStream: mockDataStream,
      chatHistory,
      partialQuery,
    });

    const result = await toolInstance.execute({ chatHistory, partialQuery });

    expect(mockedStreamObject).toHaveBeenCalledTimes(1);
    expect(result.suggestions).toEqual([]);
  });
});

// Helper to ensure the schema is correctly inferred by Zod in the tool
// This isn't a runtime test but can help catch type issues with Zod schemas if they become complex
describe('requestProactiveSuggestions tool schema', () => {
  test('parameters schema should match expected structure', () => {
    const toolDefinition = requestProactiveSuggestions({
      dataStream: mockDataStream,
      chatHistory: [],
      partialQuery: '',
    });
    // Example of checking parts of the schema if needed
    expect(toolDefinition.parameters).toBeDefined();
    const parsed = toolDefinition.parameters.parse({
        chatHistory: [{role: 'user', content: 'hi'}],
        partialQuery: "test"
    });
    expect(parsed.partialQuery).toBe("test");
    expect(parsed.chatHistory[0].content).toBe("hi");
  });
});
