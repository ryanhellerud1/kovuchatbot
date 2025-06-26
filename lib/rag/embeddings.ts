import { embed, embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';

/**
 * Generate embeddings for a single text using OpenAI's text-embedding-3-small model
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: text,
    });
    
    return embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw new Error('Failed to generate embedding');
  }
}

/**
 * Generate embeddings for multiple texts in batch
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  try {
    const { embeddings } = await embedMany({
      model: openai.embedding('text-embedding-3-small'),
      values: texts,
    });
    
    return embeddings;
  } catch (error) {
    console.error('Error generating embeddings:', error);
    throw new Error('Failed to generate embeddings');
  }
}

/**
 * Get the dimension of the embedding model
 * text-embedding-3-small has 1536 dimensions
 */
export const EMBEDDING_DIMENSION = 1536;