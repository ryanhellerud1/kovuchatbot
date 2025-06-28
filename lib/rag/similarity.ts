/**
 * Calculate cosine similarity between two vectors
 * Returns a value between -1 and 1, where 1 means identical vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  
  if (magnitude === 0) {
    return 0;
  }

  return dotProduct / magnitude;
}

/**
 * Calculate similarities between a query vector and multiple document vectors
 * Returns array of similarity scores in the same order as the document vectors
 */
export function calculateSimilarities(
  queryVector: number[],
  documentVectors: number[][]
): number[] {
  return documentVectors.map(docVector => 
    cosineSimilarity(queryVector, docVector)
  );
}

/**
 * Find the top K most similar vectors
 * Returns indices and similarity scores sorted by similarity (highest first)
 */
export function findTopSimilar(
  queryVector: number[],
  documentVectors: number[][],
  k: number = 5
): Array<{ index: number; similarity: number }> {
  const similarities = calculateSimilarities(queryVector, documentVectors);
  
  return similarities
    .map((similarity, index) => ({ index, similarity }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}

/**
 * Filter results by minimum similarity threshold
 */
export function filterBySimilarity<T>(
  items: T[],
  similarities: number[],
  threshold: number = 0.7
): Array<T & { similarity: number }> {
  return items
    .map((item, index) => ({ ...item, similarity: similarities[index] }))
    .filter(item => item.similarity >= threshold);
}