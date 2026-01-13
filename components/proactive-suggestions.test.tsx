import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom'; // For extended matchers

import { ProactiveSuggestions } from './proactive-suggestions';
import { UseChatHelpers } from '@ai-sdk/react';

// Mock framer-motion
jest.mock('framer-motion', () => ({
  ...jest.requireActual('framer-motion'), // Keep other exports
  motion: {
    // Replace motion.div with a simple div for testing purposes
    // We ensure that any props passed to motion.div are spread onto the div
    // and children are correctly rendered.
    div: jest.fn(({ children, ...props }) => <div {...props}>{children}</div>),
  },
}));

describe('ProactiveSuggestions', () => {
  let mockAppend: jest.MockedFunction<UseChatHelpers['append']>;
  let mockOnDismiss: jest.Mock;

  beforeEach(() => {
    mockAppend = jest.fn();
    mockOnDismiss = jest.fn();
  });

  // Test 1: Renders suggestions when visible and suggestions are provided
  test('renders suggestions when visible and suggestions are provided', () => {
    const suggestions = ['Suggestion 1', 'Suggestion 2'];
    render(
      <ProactiveSuggestions
        suggestions={suggestions}
        append={mockAppend}
        isVisible={true}
        onDismiss={mockOnDismiss}
      />
    );

    expect(screen.getByText('Suggestions:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suggestion 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suggestion 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByTestId('proactive-suggestions')).toBeInTheDocument();
  });

  // Test 2: Does not render when isVisible is false
  test('does not render when isVisible is false', () => {
    const suggestions = ['Suggestion 1'];
    render(
      <ProactiveSuggestions
        suggestions={suggestions}
        append={mockAppend}
        isVisible={false}
        onDismiss={mockOnDismiss}
      />
    );

    expect(screen.queryByTestId('proactive-suggestions')).not.toBeInTheDocument();
  });

  // Test 3: Does not render when suggestions array is empty
  test('does not render when suggestions array is empty', () => {
    const suggestions: string[] = [];
    render(
      <ProactiveSuggestions
        suggestions={suggestions}
        append={mockAppend}
        isVisible={true}
        onDismiss={mockOnDismiss}
      />
    );

    expect(screen.queryByTestId('proactive-suggestions')).not.toBeInTheDocument();
  });

  // Test 4: Calls append and onDismiss when a suggestion is clicked
  test('calls append and onDismiss when a suggestion is clicked', () => {
    const suggestions = ['Click Me'];
    render(
      <ProactiveSuggestions
        suggestions={suggestions}
        append={mockAppend}
        isVisible={true}
        onDismiss={mockOnDismiss}
      />
    );

    const suggestionButton = screen.getByRole('button', { name: 'Click Me' });
    fireEvent.click(suggestionButton);

    expect(mockAppend).toHaveBeenCalledTimes(1);
    expect(mockAppend).toHaveBeenCalledWith({ role: 'user', content: 'Click Me' });
    expect(mockOnDismiss).toHaveBeenCalledTimes(1);
  });

  // Test 5: Calls onDismiss when the "Close" button is clicked
  test('calls onDismiss when the "Close" button is clicked', () => {
    const suggestions = ['Suggestion'];
    render(
      <ProactiveSuggestions
        suggestions={suggestions}
        append={mockAppend}
        isVisible={true}
        onDismiss={mockOnDismiss}
      />
    );

    const closeButton = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeButton);

    expect(mockOnDismiss).toHaveBeenCalledTimes(1);
    expect(mockAppend).not.toHaveBeenCalled();
  });
});
