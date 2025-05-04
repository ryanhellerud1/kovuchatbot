'use client';

import { useState, useEffect, ReactNode } from 'react';
import { useMediaQuery } from 'usehooks-ts';
import { LoaderIcon, ChevronDownIcon, ArrowUpIcon } from './icons';
import { MathEquation } from './MathEquation';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

interface MessageReasoningProps {
  isLoading: boolean;
  reasoning: string;
}

const aiEquations = [
  '\\nabla J(\\theta)',
  '\\sigma(z)',
  'L(y, \\hat{y})',
  '\\max(0, x)',
  '\\frac{QK^T}{\\sqrt{d_k}}',
  'D_{KL}(P||Q)',
  'm_t = \\dots g_t',
  'e^{z_i}',
  '\\mathbf{w} \\cdot \\mathbf{x}',
  '\\sum_{i=1}^{n}',
  '\\alpha',
  '\\lambda ||\\mathbf{w}||^2',
  'P(A|B)',
];

// Helper function for random integer
function getRandomInt(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function MessageReasoning({ isLoading, reasoning }: MessageReasoningProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [isExpanded, setIsExpanded] = useState(isDesktop);
  // State to hold the array of React nodes (strings and MathEquation components)
  const [contentParts, setContentParts] = useState<ReactNode[]>([]);

  console.log('MessageReasoning received reasoning prop:', reasoning);

  useEffect(() => {
    if (reasoning) {
      console.log('MessageReasoning useEffect triggered with reasoning:', reasoning);
      const words = reasoning.split(' ').filter(word => word.trim() !== ''); // Split and remove empty strings
      const newContentParts: ReactNode[] = [];
      let currentIndex = 0;

      while (currentIndex < words.length) {
        // Determine chunk size (3-12 words)
        const chunkSize = getRandomInt(2, 5);
        const textChunk = words.slice(currentIndex, currentIndex + chunkSize).join(' ');
        if (textChunk) {
          newContentParts.push(textChunk + ' '); // Add space after text chunk
        }
        currentIndex += chunkSize;

        // If there are more words, add an equation and skip next 12 words
        if (currentIndex < words.length) {
          const randomEquation = aiEquations[Math.floor(Math.random() * aiEquations.length)];
          newContentParts.push(
            <MathEquation 
              key={`eq-${currentIndex}`} // Add key for list rendering
              equation={randomEquation} 
              displayMode={false} // Use inline display mode
            />
          );
          // Add a space after the equation for readability
          newContentParts.push(' '); 
          currentIndex += 12; // Skip words for the equation
        }
      }
      console.log('Calculated contentParts:', newContentParts);
      setContentParts(newContentParts);
    }
  }, [reasoning]);

  useEffect(() => {
    if (isDesktop) {
      setIsExpanded(true);
    }
  }, [isDesktop]);

  if (!reasoning) return null;

  console.log('MessageReasoning render state:', { isLoading, isExpanded, hasContentParts: contentParts.length > 0 });
  if (isExpanded) {
    console.log('Rendering contentParts value:', contentParts);
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Reasoning</span>
          {isLoading && (
            <div className="animate-spin">
              <LoaderIcon size={16} />
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? <ArrowUpIcon size={16} /> : <ChevronDownIcon size={16} />}
        </Button>
      </div>
      {/* Render content only when expanded and parts are ready */}
      {isExpanded && contentParts.length > 0 && (
        <div className="flex flex-col gap-2 pl-2 border-l-2 border-muted">
          {/* Map over the content parts and render them */} 
          <div className="text-sm text-muted-foreground flex flex-wrap items-baseline"> 
            {contentParts.map((part, index) => (
              <span key={index}>{part}</span> // Wrap in span for key and baseline alignment
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
