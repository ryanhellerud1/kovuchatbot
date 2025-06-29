# LangChain RAG System

This directory contains the complete LangChain-based RAG (Retrieval-Augmented Generation) implementation that powers all document processing and knowledge search functionality.

## Files

### Core LangChain RAG Implementation
- **`document-processor.ts`** - LangChain document processing with loaders and text splitters
- **`retriever.ts`** - LangChain-based knowledge search and vector store
- **`embeddings.ts`** - LangChain embedding generation (same as document-processor.ts)
- **`similarity.ts`** - Cosine similarity calculations (shared utility)

## Usage

The system automatically uses LangChain for all RAG operations. No configuration needed!

### Document Processing

All documents are processed using LangChain components:

- **Document Loaders**: LangChain loaders for PDF, DOCX, TXT, and Markdown files
- **Text Splitting**: `RecursiveCharacterTextSplitter` for consistent, semantic chunking
- **Embeddings**: `OpenAIEmbeddings` for high-quality vector representations
- **Storage**: Custom PostgreSQL vector store maintaining existing schema compatibility

### Knowledge Search

All search operations use LangChain:

- **Vector Store**: Custom `SimplePostgreSQLVectorStore` with existing database schema
- **Similarity Search**: Improved cosine similarity search with configurable thresholds
- **Result Formatting**: Compatible with existing API responses

## Benefits of LangChain RAG

1. **Better Text Splitting**: `RecursiveCharacterTextSplitter` provides more consistent chunks
2. **Industry Standard**: Uses well-tested LangChain components
3. **Improved Performance**: Better embedding and retrieval patterns
4. **Maintainability**: Reduces custom code in favor of proven libraries
5. **Future-Proof**: Easy to add more LangChain features later

## Migration Strategy

The implementation uses a **feature flag approach**:
- Both implementations coexist
- Switch between them using `USE_LANGCHAIN_RAG` environment variable
- Existing data remains compatible
- No breaking changes to the API

## Configuration

### Environment Variables
```bash
# Enable LangChain RAG
USE_LANGCHAIN_RAG=true

# Required for LangChain embeddings
OPENAI_API_KEY=your_openai_api_key
```

### LangChain RAG Configuration
```typescript
const config = {
  chunkSize: 1000,        // Size of text chunks
  chunkOverlap: 200,      // Overlap between chunks
  embeddingModel: 'text-embedding-3-small',
  similarityThreshold: 0.4
};
```

## API Compatibility

The LangChain implementation maintains full API compatibility:
- Same database schema
- Same response formats
- Same error handling
- Same authentication

## Testing

To test the LangChain implementation:

1. Set `USE_LANGCHAIN_RAG=true`
2. Upload a document via the knowledge upload API
3. Search for content using the search knowledge tool
4. Compare results with legacy implementation

## Performance

LangChain RAG typically provides:
- More consistent chunk sizes
- Better text splitting at natural boundaries
- Improved embedding generation
- Enhanced similarity search accuracy

## Troubleshooting

### Common Issues

1. **Missing OpenAI API Key**: Ensure `OPENAI_API_KEY` is set
2. **Import Errors**: Make sure LangChain dependencies are installed
3. **Performance**: LangChain may be slightly slower initially due to additional abstractions

### Debug Logging

Enable debug logging by checking the console output. The system logs which implementation is being used:
- `[searchKnowledge] Using LangChain implementation`
- `[searchKnowledge] Using legacy implementation`

## Future Enhancements

With LangChain RAG in place, future enhancements become easier:
- Advanced retrieval strategies
- Multiple embedding models
- Hybrid search (keyword + semantic)
- Document metadata filtering
- Custom retrieval chains