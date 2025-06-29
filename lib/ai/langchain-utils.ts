import { isLangChainModel } from './langchain-providers';
import { validateLangChainEnvironment } from './langchain-providers';

/**
 * Feature flag for LangChain integration
 */
export const LANGCHAIN_ENABLED = process.env.LANGCHAIN_ENABLED === 'true';

/**
 * Check if LangChain should be used for a given model
 */
export function shouldUseLangChain(modelId: string): boolean {
  return LANGCHAIN_ENABLED && isLangChainModel(modelId);
}

/**
 * Environment validation for LangChain
 */
export function validateLangChainSetup(): {
  canUseLangChain: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  
  if (!LANGCHAIN_ENABLED) {
    issues.push('LangChain is disabled (set LANGCHAIN_ENABLED=true to enable)');
  }
  
  const envValidation = validateLangChainEnvironment();
  if (!envValidation.isValid) {
    issues.push(...envValidation.missingVars.map(v => `Missing environment variable: ${v}`));
    issues.push(...envValidation.errors);
  }
  
  return {
    canUseLangChain: issues.length === 0,
    issues,
  };
}

/**
 * Log LangChain usage for debugging
 */
export function logLangChainUsage(modelId: string, action: string): void {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[LangChain] ${action} with model: ${modelId}`);
  }
}

/**
 * Error handling for LangChain operations
 */
export class LangChainError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'LangChainError';
  }
}

/**
 * Wrap LangChain operations with error handling
 */
export async function withLangChainErrorHandling<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[LangChain] Error in ${operation}:`, error);
    throw new LangChainError(
      `LangChain ${operation} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      operation,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Performance monitoring for LangChain operations
 */
export async function withLangChainTiming<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    console.log(`[LangChain] ${operation} completed in ${duration}ms`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[LangChain] ${operation} failed after ${duration}ms:`, error);
    throw error;
  }
}

/**
 * Migration helper to gradually introduce LangChain
 */
export function createMigrationWrapper<T extends (...args: any[]) => any>(
  legacyFn: T,
  langchainFn: T,
  modelIdExtractor: (...args: Parameters<T>) => string
): T {
  return ((...args: Parameters<T>) => {
    const modelId = modelIdExtractor(...args);
    
    if (shouldUseLangChain(modelId)) {
      logLangChainUsage(modelId, 'Using LangChain implementation');
      return langchainFn(...args);
    } else {
      return legacyFn(...args);
    }
  }) as T;
}