import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.POSTGRES_URL, {
  ssl: 'require',
});

async function testConnection() {
  try {
    const result = await sql`select 1`;
    console.log('Database connection successful:', result);
  } catch (err) {
    console.error('Database connection failed:', err);
  } finally {
    await sql.end();
  }
}

testConnection();
