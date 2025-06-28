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
    
    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        throw new Error('OpenAI API key is missing or invalid. Please check your OPENAI_API_KEY environment variable.');
      } else if (error.message.includes('quota')) {
        throw new Error('OpenAI API quota exceeded. Please check your OpenAI account usage.');
      } else if (error.message.includes('rate limit')) {
        throw new Error('OpenAI API rate limit exceeded. Please try again later.');
      }
    }
    
    throw new Error('Failed to generate embedding. Please check your OpenAI API configuration.');
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
    
    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        throw new Error('OpenAI API key is missing or invalid. Please check your OPENAI_API_KEY environment variable.');
      } else if (error.message.includes('quota')) {
        throw new Error('OpenAI API quota exceeded. Please check your OpenAI account usage.');
      } else if (error.message.includes('rate limit')) {
        throw new Error('OpenAI API rate limit exceeded. Please try again later.');
      }
    }
    
    throw new Error('Failed to generate embeddings. Please check your OpenAI API configuration.');
  }
}

/**
 * Get the dimension of the embedding model
 * text-embedding-3-small has 1536 dimensions
 */
export const EMBEDDING_DIMENSION = 1536;