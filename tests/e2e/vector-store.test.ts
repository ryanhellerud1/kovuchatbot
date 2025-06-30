
import { test, expect } from '@playwright/test';
import { createPostgreSQLVectorStore } from '@/lib/rag/langchain-vector-store';
import { Document } from '@langchain/core/documents';
import { OpenAIEmbeddings } from '@langchain/openai';
import { createUser, deleteUser } from '../helpers';
import { db, dbClient } from '@/lib/db/client';
import { knowledgeDocuments, documentChunks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

test.describe('PostgreSQLVectorStore', () => {
  let userId: string;
  let vectorStore: any;
  let documentId: string;

  test.beforeAll(async () => {
    const user = await createUser();
    userId = user.id;
    const embeddings = new OpenAIEmbeddings({
      model: 'text-embedding-3-large',
    });
    vectorStore = await createPostgreSQLVectorStore(userId, embeddings);
  });

  test.afterAll(async () => {
    await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
    await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, documentId));
    await deleteUser(userId);
    await dbClient.end();
  });

  test('should add documents and perform similarity search', async () => {
    const documents = [
      new Document({ pageContent: 'The sky is blue.' }),
      new Document({ pageContent: 'The sun is bright.' }),
      new Document({ pageContent: 'The moon is high.' }),
    ];

    const ids = await vectorStore.addDocuments(documents, {
      documentTitle: 'Test Document',
    });

    documentId = ids[0].split('_')[0];

    const results = await vectorStore.similaritySearchWithScore(
      'What color is the sky?',
      1,
    );

    expect(results).toHaveLength(1);
    expect(results[0][0].pageContent).toBe('The sky is blue.');
    expect(results[0][1]).toBeGreaterThan(0.8);
  });
});

