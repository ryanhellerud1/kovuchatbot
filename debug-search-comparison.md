# Search Results Comparison Debug

## Query: "what was the dominant 'image of man' was for the Greeks according to my documents?"

### Analysis of Query Characteristics:
- **Query length**: 13 tokens
- **Has question words**: Yes ("what")
- **Has quotes**: Yes ("image of man")
- **Expected dynamic threshold adjustments**:
  - Base threshold: 0.25
  - Long query (>8 tokens): +0.05 → 0.30
  - Has question words: -0.08 → 0.22
  - Has quotes: -0.12 → 0.10 (minimum 0.15) → **0.15**

### Expected Search Parameters:
- **Limit**: 8 (default)
- **Minimum Similarity**: 0.15 (after dynamic adjustments)
- **Fetch multiplier**: 8 * 3 = 24 initial results

### Potential Differences Between Localhost and Production:

1. **Environment Variables**
   - OpenAI API key differences
   - Database connection differences
   - Model availability

2. **Database Content**
   - Different documents uploaded
   - Different embedding quality
   - Different chunk counts

3. **API Rate Limiting**
   - Production might have rate limits
   - Embedding generation might be throttled

4. **Caching Issues**
   - Old embeddings in production
   - Different embedding model versions

5. **Configuration Differences**
   - Different environment-specific settings
   - Different model configurations

## Debugging Steps:

1. Check if both environments have the same documents
2. Compare embedding generation between environments
3. Check console logs for threshold adjustments
4. Verify API key configurations
5. Compare database query results