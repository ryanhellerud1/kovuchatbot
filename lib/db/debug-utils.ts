import { db } from './client';
import { sql } from 'drizzle-orm';

/**
 * Debug utilities for database troubleshooting
 */

/**
 * Test basic database connectivity
 */
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    const result = await db.execute(sql`SELECT 1 as test, NOW() as current_time`);
    console.log('[DB Debug] Connection test successful:', result[0]);
    return true;
  } catch (error) {
    console.error('[DB Debug] Connection test failed:', error);
    return false;
  }
}

/**
 * Get database connection info
 */
export async function getDatabaseInfo(): Promise<any> {
  try {
    const result = await db.execute(sql`
      SELECT 
        current_database() as database_name,
        current_user as current_user,
        version() as version,
        inet_server_addr() as server_address,
        inet_server_port() as server_port
    `);
    return result[0];
  } catch (error) {
    console.error('[DB Debug] Failed to get database info:', error);
    return null;
  }
}

/**
 * Check table counts for debugging
 */
export async function getTableCounts(userId?: string): Promise<any> {
  try {
    const queries = [
      sql`SELECT COUNT(*) as knowledge_documents_count FROM knowledge_documents`,
      sql`SELECT COUNT(*) as document_chunks_count FROM document_chunks`,
    ];

    if (userId) {
      queries.push(
        sql`SELECT COUNT(*) as user_documents_count FROM knowledge_documents WHERE user_id = ${userId}`,
        sql`SELECT COUNT(*) as user_chunks_count FROM document_chunks dc 
            JOIN knowledge_documents kd ON dc.document_id = kd.id 
            WHERE kd.user_id = ${userId}`
      );
    }

    const results = await Promise.all(queries.map(query => db.execute(query)));
    
    const counts = {
      total_documents: results[0][0]?.knowledge_documents_count || 0,
      total_chunks: results[1][0]?.document_chunks_count || 0,
    };

    if (userId) {
      counts.user_documents = results[2][0]?.user_documents_count || 0;
      counts.user_chunks = results[3][0]?.user_chunks_count || 0;
    }

    return counts;
  } catch (error) {
    console.error('[DB Debug] Failed to get table counts:', error);
    return null;
  }
}