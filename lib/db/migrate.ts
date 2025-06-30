import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

config({
  path: '.env.local',
});

const runMigrate = async () => {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not defined');
  }

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
  const db = drizzle(connection);

  console.log('Running migrations...');

  const start = Date.now();
  
  try {
    // Enable pgvector extension first
    await db.execute(`CREATE EXTENSION IF NOT EXISTS vector;`);
    console.log('pgvector extension enabled');
    
    // Run migrations
    await migrate(db, { migrationsFolder: './lib/db/migrations' });
    
    const end = Date.now();
    console.log('Migrations completed in', end - start, 'ms');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await connection.end();
  }
  
  process.exit(0);
};

runMigrate().catch((err) => {
  console.error('Migration failed');
  console.error(err);
  process.exit(1);
});