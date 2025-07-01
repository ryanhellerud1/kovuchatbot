import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

async function main() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not set');
  }
  const sql = postgres(process.env.POSTGRES_URL, { max: 1 });
  const db = drizzle(sql);

  await db.execute(`DROP TABLE IF EXISTS document_chunks;`);

  console.log('Table dropped');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
