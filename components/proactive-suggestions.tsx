'use client';

import { motion } from 'framer-motion';
import { Button } from './ui/button'; // Assuming this is the correct path
import { memo, useState, useEffect } from 'react';
import { UseChatHelpers } from '@ai-sdk/react'; // Or appropriate type for append function

interface ProactiveSuggestionsProps {
  suggestions: string[];
  append: UseChatHelpers['append']; // Or appropriate type
  isVisible: boolean;
  onDismiss: () => void;
}

function PureProactiveSuggestions({
  suggestions,
  append,
  isVisible,
  onDismiss,
}: ProactiveSuggestionsProps) {
  if (!isVisible || suggestions.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.2 }}
      className="absolute bottom-full left-0 right-0 mb-2 p-2 bg-background border rounded-md shadow-lg z-10"
      data-testid="proactive-suggestions"
    >
      <div className="flex justify-between items-center mb-1">
        <p className="text-xs text-muted-foreground px-2">Suggestions:</p>
        <Button variant="ghost" size="sm" onClick={onDismiss} className="text-xs">
          Close
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-1">
        {suggestions.map((suggestion, index) => (
          <Button
            key={`proactive-suggestion-${index}`}
            variant="outline"
            onClick={() => {
              append({
                role: 'user',
                content: suggestion,
                // Potentially add an identifier that this was from a suggestion
              });
              onDismiss(); // Dismiss after appending
            }}
            className="text-left w-full h-auto justify-start items-start px-3 py-2 text-sm"
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </motion.div>
  );
}

export const ProactiveSuggestions = memo(PureProactiveSuggestions);
