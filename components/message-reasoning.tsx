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
  '\\int_{a}^{b} f(x) dx',
  '\\frac{\\partial f}{\\partial x}',
  '\\lim_{x \\to \\infty} f(x)',
  '\\sum_{n=1}^{\\infty} a_n',
  '\\prod_{i=1}^{n} x_i',
  '\\frac{d}{dx} f(x)',
  '\\oint_C \\mathbf{F} \\cdot d\\mathbf{r}',
  '|\\psi\\rangle',
  '\\langle \\phi|',
  '\\hat{H} |\\psi\\rangle = E |\\psi\\rangle',
  '\\sigma_x = \\begin{pmatrix} 0 & 1 \\\\ 1 & 0 \\end{pmatrix}',
  '|0\\rangle = \\begin{pmatrix} 1 \\\\ 0 \\end{pmatrix}',
  '|1\\rangle = \\begin{pmatrix} 0 \\\\ 1 \\end{pmatrix}',
  '\\frac{1}{\\sqrt{2}}(|0\\rangle + |1\\rangle)',
  '\\hat{U} = e^{-i\\hat{H}t}',
  '\\langle \\psi|\\phi \\rangle',
  '\\hat{X}|0\\rangle = |1\\rangle',
  '\\hat{Z}|+\\rangle = |-\\rangle',
  '\\hat{H} = \\frac{1}{\\sqrt{2}} \\begin{pmatrix} 1 & 1 \\\\ 1 & -1 \\end{pmatrix}',
];

// Helper function for random integer
function getRandomInt(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function MessageReasoning({ isLoading, reasoning }: MessageReasoningProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [isExpanded, setIsExpanded] = useState(true);
  const [contentParts, setContentParts] = useState<ReactNode[]>([]);
  const [processedWords, setProcessedWords] = useState<number>(0);

  console.log('MessageReasoning received reasoning prop:', reasoning);

  useEffect(() => {
    if (reasoning) {
      const words = reasoning.split(' ').filter(word => word.trim() !== '');
      
      // Only process new words
      if (words.length > processedWords) {
        const newWords = words.slice(processedWords);
        const newContentParts: ReactNode[] = [];
        let currentIndex = 0;

        while (currentIndex < newWords.length) {
          const chunkSize = Math.min(3, newWords.length - currentIndex); // Reduced from 5 to 3
          const textChunk = newWords.slice(currentIndex, currentIndex + chunkSize).join(' ');
          if (textChunk) {
            newContentParts.push(textChunk + ' ');
          }
          currentIndex += chunkSize;

          // Add equation after every chunk
          const randomEquation = aiEquations[Math.floor(Math.random() * aiEquations.length)];
          newContentParts.push(
            <MathEquation 
              key={`eq-${processedWords + currentIndex}`}
              equation={randomEquation} 
              displayMode={false}
            />
          );
          newContentParts.push(' ');
        }

        setContentParts(prevParts => [...prevParts, ...newContentParts]);
        setProcessedWords(words.length);
      }
    }
  }, [reasoning, processedWords]);

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
