import { db } from './client';
import { sql } from 'drizzle-orm';

/**
 * Check if the database connection is healthy
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    console.log('[DB Health Check] Testing database connection...');
    
    // Simple query to test connection
    const result = await db.execute(sql`SELECT 1 as health_check`);
    
    if (result && result.length > 0) {
      console.log('[DB Health Check] Database connection is healthy');
      return true;
    } else {
      console.error('[DB Health Check] Database query returned no results');
      return false;
    }
  } catch (error) {
    console.error('[DB Health Check] Database connection failed:', error);
    return false;
  }
}

/**
 * Check if pgvector extension is available
 */
export async function checkPgVectorExtension(): Promise<boolean> {
  try {
    console.log('[DB Health Check] Testing pgvector extension...');
    
    // Check if pgvector extension is installed
    const result = await db.execute(sql`
      SELECT EXISTS(
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) as has_vector
    `);
    
    const hasVector = result[0]?.has_vector;
    
    if (hasVector) {
      console.log('[DB Health Check] pgvector extension is available');
      return true;
    } else {
      console.error('[DB Health Check] pgvector extension is not installed');
      return false;
    }
  } catch (error) {
    console.error('[DB Health Check] Failed to check pgvector extension:', error);
    return false;
  }
}

/**
 * Comprehensive database health check
 */
export async function performDatabaseHealthCheck(): Promise<{
  isHealthy: boolean;
  hasVector: boolean;
  error?: string;
}> {
  try {
    const [isHealthy, hasVector] = await Promise.all([
      checkDatabaseHealth(),
      checkPgVectorExtension(),
    ]);

    return {
      isHealthy,
      hasVector,
    };
  } catch (error) {
    console.error('[DB Health Check] Comprehensive health check failed:', error);
    return {
      isHealthy: false,
      hasVector: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}