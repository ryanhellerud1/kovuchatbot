import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL is not set');
}

console.log('POSTGRES_URL from client.ts:', process.env.POSTGRES_URL);

// Configure postgres client with better connection handling for Neon
const client = postgres(process.env.POSTGRES_URL, {
  // Connection pooling configuration
  max: 10, // Maximum number of connections in the pool
  idle_timeout: 20, // Close idle connections after 20 seconds
  connect_timeout: 10, // Connection timeout in seconds
  
  // Retry configuration for better reliability
  max_lifetime: 60 * 30, // 30 minutes max connection lifetime
  
  // SSL configuration for Neon - always require SSL for Neon databases
  ssl: 'require',
  
  // Transform undefined to null for better compatibility
  transform: {
    undefined: null,
  },
  
  // Connection error handling
  onnotice: () => {}, // Suppress notices
  debug: process.env.NODE_ENV === 'development',
});

export const db = drizzle(client);
export const dbClient = client;
