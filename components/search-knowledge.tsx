'use client';

import { SearchIcon } from './icons';
import { Skeleton } from './ui/skeleton';
import { cn } from '@/lib/utils';

interface SearchKnowledgeProps {
  isLoading?: boolean;
  query?: string;
  results?: Array<{
    id: string;
    content: string;
    similarity: number;
    source: {
      documentId: string;
      documentTitle: string;
      chunkIndex: number;
    };
    metadata?: any;
    keywordBoost?: number;
  }>;
}

export function SearchKnowledge({ isLoading = false, query, results }: SearchKnowledgeProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl p-4 bg-muted/50 max-w-[500px]">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center">
            <div className="text-primary animate-pulse">
              <SearchIcon size={16} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium">Searching knowledge base...</div>
            {query && (
              <div className="text-xs text-muted-foreground">
                Query: &ldquo;{query}&rdquo;
              </div>
            )}
          </div>
        </div>
        
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  if (!results || results.length === 0) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl p-4 bg-muted/50 max-w-[500px]">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-full bg-muted flex items-center justify-center">
            <div className="text-muted-foreground">
              <SearchIcon size={16} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium">No results found</div>
            {query && (
              <div className="text-xs text-muted-foreground">
                No matches for &ldquo;{query}&rdquo; in your knowledge base
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl p-4 bg-muted/50 max-w-[500px]">
      <div className="flex items-center gap-3">
        <div className="size-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <div className="text-green-600 dark:text-green-400">
            <SearchIcon size={16} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium">
            Found {results.length} result{results.length === 1 ? '' : 's'}
          </div>
          {query && (
            <div className="text-xs text-muted-foreground">
              Searched for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      </div>
      
      <div className="space-y-2">
        {results.slice(0, 3).map((result, index) => (
          <div
            key={result.id}
            className="p-3 rounded-lg bg-background/50 border border-border/50"
          >
            <div className="text-sm font-medium mb-1 line-clamp-1">
              {result.source.documentTitle}
            </div>
            <div className="text-xs text-muted-foreground line-clamp-2">
              {result.content}
            </div>
            <div className="flex justify-between items-center mt-1">
              <div className="text-xs text-muted-foreground">
                Relevance: {Math.round(result.similarity * 100)}%
              </div>
              {result.keywordBoost && (
                <div className="text-xs text-green-600 dark:text-green-400">
                  +{Math.round(result.keywordBoost * 100)}% boost
                </div>
              )}
            </div>
          </div>
        ))}
        
        {results.length > 3 && (
          <div className="text-xs text-muted-foreground text-center py-2">
            +{results.length - 3} more result{results.length - 3 === 1 ? '' : 's'}
          </div>
        )}
      </div>
    </div>
  );
}