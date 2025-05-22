import { POST } from './route'; // Assuming route.ts is in the same directory
import { NextRequest } from 'next/server';
import { auth as mockAuthInternal } from '@/app/(auth)/auth';
import { requestProactiveSuggestions as mockRequestProactiveSuggestionsInternal } from '@/lib/ai/tools/request-proactive-suggestions';

// Type assertion for mocks
const mockAuth = mockAuthInternal as jest.Mock;
const mockRequestProactiveSuggestions = mockRequestProactiveSuggestionsInternal as jest.Mock;

jest.mock('@/app/(auth)/auth', () => ({
  auth: jest.fn(),
}));

jest.mock('@/lib/ai/tools/request-proactive-suggestions', () => ({
  requestProactiveSuggestions: jest.fn(),
}));

describe('POST /api/chat/proactive-suggestions', () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockRequestProactiveSuggestions.mockReset();
  });

  // Test 1: Successful request
  test('should return 200 with suggestions on a successful request', async () => {
    const mockExecute = jest.fn().mockResolvedValue({ suggestions: ['suggestion1', 'suggestion2'] });
    mockRequestProactiveSuggestions.mockReturnValue({ execute: mockExecute });
    mockAuth.mockResolvedValue({ user: { id: 'test-user-id' } });

    const requestBody = { partialQuery: 'hello', chatHistory: [] };
    const mockRequest = new NextRequest('http://localhost/api/chat/proactive-suggestions', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(mockRequest);
    const responseBody = await response.json();

    expect(mockAuth).toHaveBeenCalledTimes(1);
    expect(mockRequestProactiveSuggestions).toHaveBeenCalledTimes(1);
    // Check parameters passed to the factory function requestProactiveSuggestions
    expect(mockRequestProactiveSuggestions.mock.calls[0][0].chatHistory).toEqual(requestBody.chatHistory);
    expect(mockRequestProactiveSuggestions.mock.calls[0][0].partialQuery).toEqual(requestBody.partialQuery);
    expect(mockRequestProactiveSuggestions.mock.calls[0][0].dataStream).toBeDefined(); // Check if dataStream is passed

    // Check parameters passed to the execute method
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith({
      chatHistory: requestBody.chatHistory,
      partialQuery: requestBody.partialQuery,
    });

    expect(response.status).toBe(200);
    expect(responseBody).toEqual({ suggestions: ['suggestion1', 'suggestion2'] });
  });

  // Test 2: Unauthorized request
  test('should return 401 if user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null); // No session

    const mockRequest = new NextRequest('http://localhost/api/chat/proactive-suggestions', {
      method: 'POST',
      body: JSON.stringify({ partialQuery: 'test', chatHistory: [] }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(mockRequest);
    const responseBody = await response.json();

    expect(response.status).toBe(401);
    expect(responseBody).toEqual({ error: 'Unauthorized' });
  });

  // Test 3: Invalid request body (missing partialQuery)
  test('should return 400 if partialQuery is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'test-user-id' } });

    const mockRequest = new NextRequest('http://localhost/api/chat/proactive-suggestions', {
      method: 'POST',
      body: JSON.stringify({ chatHistory: [] }), // partialQuery is missing
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(mockRequest);
    const responseBody = await response.json();

    expect(response.status).toBe(400);
    expect(responseBody).toEqual({ error: 'Missing partialQuery or chatHistory' });
  });

    // Test 4: Tool execution returns no suggestions
  test('should return 200 with an empty suggestions array if tool provides no suggestions', async () => {
    const mockExecute = jest.fn().mockResolvedValue({ suggestions: [] }); // Tool returns empty suggestions
    mockRequestProactiveSuggestions.mockReturnValue({ execute: mockExecute });
    mockAuth.mockResolvedValue({ user: { id: 'test-user-id' } });

    const requestBody = { partialQuery: 'query', chatHistory: [{role: 'user' as const, content: 'hi'}] };
    const mockRequest = new NextRequest('http://localhost/api/chat/proactive-suggestions', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(mockRequest);
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody).toEqual({ suggestions: [] });
  });

  // Test 5: Tool execution throws an error
  test('should return 500 if tool execution throws an error', async () => {
    const mockExecute = jest.fn().mockRejectedValue(new Error('Tool failed'));
    mockRequestProactiveSuggestions.mockReturnValue({ execute: mockExecute });
    mockAuth.mockResolvedValue({ user: { id: 'test-user-id' } });

    const requestBody = { partialQuery: 'another query', chatHistory: [] };
    const mockRequest = new NextRequest('http://localhost/api/chat/proactive-suggestions', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(mockRequest);
    const responseBody = await response.json();

    expect(response.status).toBe(500);
    expect(responseBody).toEqual({ error: 'Tool failed' });
  });
});
