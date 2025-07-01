import { encode } from 'gpt-tokenizer';

/**
 * Count tokens in a text string using GPT tokenizer
 * This gives us accurate token counts for context management
 */
export function countTokens(text: string): number {
  try {
    const tokens = encode(text);
    return tokens.length;
  } catch (error) {
    console.warn('Failed to count tokens, falling back to character estimate:', error);
    // Fallback to rough character-based estimate (1 token ≈ 4 characters)
    return Math.ceil(text.length / 4);
  }
}

/**
 * Count tokens for multiple text strings
 */
export function countTokensMultiple(texts: string[]): number {
  return texts.reduce((total, text) => total + countTokens(text), 0);
}

/**
 * Estimate tokens from character count (rough approximation)
 */
export function estimateTokensFromChars(charCount: number): number {
  return Math.ceil(charCount / 4);
}

/**
 * Get detailed token statistics for search results
 */
export interface TokenStats {
  totalTokens: number;
  totalChars: number;
  averageTokensPerResult: number;
  tokenToCharRatio: number;
  results: Array<{
    rank: number;
    tokens: number;
    chars: number;
    content: string;
  }>;
}

export function getSearchResultTokenStats(results: Array<{ rank: number; content: string }>): TokenStats {
  const resultStats = results.map(result => ({
    rank: result.rank,
    tokens: countTokens(result.content),
    chars: result.content.length,
    content: result.content.substring(0, 100) + (result.content.length > 100 ? '...' : ''),
  }));

  const totalTokens = resultStats.reduce((sum, stat) => sum + stat.tokens, 0);
  const totalChars = resultStats.reduce((sum, stat) => sum + stat.chars, 0);

  return {
    totalTokens,
    totalChars,
    averageTokensPerResult: results.length > 0 ? Math.round(totalTokens / results.length) : 0,
    tokenToCharRatio: totalChars > 0 ? Math.round((totalTokens / totalChars) * 100) / 100 : 0,
    results: resultStats,
  };
}

/**
 * Format token stats for logging
 */
export function formatTokenStats(stats: TokenStats): string {
  return [
    `📊 Token Usage: ${stats.totalTokens} tokens (${stats.totalChars} chars)`,
    `📈 Ratio: ${stats.tokenToCharRatio} tokens/char`,
    `📋 Average: ${stats.averageTokensPerResult} tokens/result`,
    `🔢 Results: ${stats.results.length}`,
  ].join(' | ');
}