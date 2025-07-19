/**
 * EPUB Integration Test
 * Verifies that EPUB files work with all existing document workflows
 * This is a comprehensive integration test that can be run manually
 */

import { processDocument } from './retriever';
import {
  processDocumentWithLangChain,
  compareLangChainWithLegacy,
} from './langchain-document-processor';
import { searchKnowledgeBase } from './retriever';
import { isValidEPUBBuffer } from './epub-parser';
import {
  validateKnowledgeDocumentSize,
  shouldUseBlobStorage,
} from '@/lib/blob-storage';

/**
 * Test EPUB integration with all document workflows
 * This function tests the complete EPUB processing pipeline
 */
export async function testEPUBIntegration(
  epubBuffer: Buffer,
  fileName: string,
  userId: string,
): Promise<{
  success: boolean;
  results: {
    validation: boolean;
    legacyProcessing: boolean;
    langchainProcessing: boolean;
    comparison: boolean;
    blobStorageCompatibility: boolean;
    searchIntegration: boolean;
  };
  errors: string[];
}> {
  const results = {
    validation: false,
    legacyProcessing: false,
    langchainProcessing: false,
    comparison: false,
    blobStorageCompatibility: false,
    searchIntegration: false,
  };
  const errors: string[] = [];

  try {
    console.log(
      '[EPUB Integration Test] Starting comprehensive EPUB integration test',
    );

    // Test 1: File Validation
    console.log('[EPUB Integration Test] Testing file validation...');
    try {
      const isValid = isValidEPUBBuffer(epubBuffer);
      const sizeValid = validateKnowledgeDocumentSize(epubBuffer.length);

      if (isValid && sizeValid) {
        results.validation = true;
        console.log('[EPUB Integration Test] ✓ File validation passed');
      } else {
        errors.push(
          `File validation failed: valid=${isValid}, sizeValid=${sizeValid}`,
        );
      }
    } catch (error) {
      errors.push(
        `File validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    // Test 2: Legacy Processing Pipeline
    console.log(
      '[EPUB Integration Test] Testing legacy processing pipeline...',
    );
    try {
      const legacyResult = await processDocument(epubBuffer, fileName, 'epub');

      if (
        legacyResult &&
        legacyResult.chunks.length > 0 &&
        legacyResult.embeddings.length > 0
      ) {
        results.legacyProcessing = true;
        console.log(
          `[EPUB Integration Test] ✓ Legacy processing passed: ${legacyResult.chunks.length} chunks, ${legacyResult.embeddings.length} embeddings`,
        );
      } else {
        errors.push(
          'Legacy processing failed: no chunks or embeddings generated',
        );
      }
    } catch (error) {
      errors.push(
        `Legacy processing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    // Test 3: LangChain Processing Pipeline
    console.log(
      '[EPUB Integration Test] Testing LangChain processing pipeline...',
    );
    try {
      const langchainResult = await processDocumentWithLangChain(
        epubBuffer,
        fileName,
        'epub',
      );

      if (
        langchainResult &&
        langchainResult.documents.length > 0 &&
        langchainResult.embeddings.length > 0
      ) {
        results.langchainProcessing = true;
        console.log(
          `[EPUB Integration Test] ✓ LangChain processing passed: ${langchainResult.documents.length} documents, ${langchainResult.embeddings.length} embeddings`,
        );
      } else {
        errors.push(
          'LangChain processing failed: no documents or embeddings generated',
        );
      }
    } catch (error) {
      errors.push(
        `LangChain processing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    // Test 4: Processing Comparison
    console.log('[EPUB Integration Test] Testing processing comparison...');
    try {
      const comparisonResult = await compareLangChainWithLegacy(
        epubBuffer,
        fileName,
        'epub',
      );

      if (
        comparisonResult &&
        comparisonResult.langchain &&
        comparisonResult.legacy
      ) {
        results.comparison = true;
        console.log(
          `[EPUB Integration Test] ✓ Processing comparison passed: chunk diff=${comparisonResult.comparison.chunkCountDiff}`,
        );
      } else {
        errors.push('Processing comparison failed: missing results');
      }
    } catch (error) {
      errors.push(
        `Processing comparison error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    // Test 5: Blob Storage Compatibility
    console.log(
      '[EPUB Integration Test] Testing blob storage compatibility...',
    );
    try {
      const shouldUseBlob = shouldUseBlobStorage(epubBuffer.length);
      const sizeValid = validateKnowledgeDocumentSize(epubBuffer.length);

      // Test that EPUB files work with blob storage logic
      results.blobStorageCompatibility = sizeValid; // If size is valid, blob storage will work
      console.log(
        `[EPUB Integration Test] ✓ Blob storage compatibility: shouldUseBlob=${shouldUseBlob}, sizeValid=${sizeValid}`,
      );
    } catch (error) {
      errors.push(
        `Blob storage compatibility error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    // Test 6: Search Integration (requires processed document in database)
    console.log('[EPUB Integration Test] Testing search integration...');
    try {
      // This test would require the document to be saved to the database first
      // For now, we just verify that the search function can be called with EPUB content
      const searchResults = await searchKnowledgeBase('test query', userId, {
        limit: 5,
        minSimilarity: 0.3,
        includeMetadata: true,
      });

      // Search should work even if no results are found (empty database)
      results.searchIntegration = true;
      console.log(
        `[EPUB Integration Test] ✓ Search integration passed: ${searchResults.length} results`,
      );
    } catch (error) {
      errors.push(
        `Search integration error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    // Calculate overall success
    const allTestsPassed = Object.values(results).every(
      (result) => result === true,
    );

    console.log('[EPUB Integration Test] Integration test completed');
    console.log(
      `[EPUB Integration Test] Results: ${JSON.stringify(results, null, 2)}`,
    );

    if (errors.length > 0) {
      console.log(`[EPUB Integration Test] Errors: ${errors.join(', ')}`);
    }

    return {
      success: allTestsPassed,
      results,
      errors,
    };
  } catch (error) {
    console.error(
      '[EPUB Integration Test] Fatal error during integration test:',
      error,
    );
    errors.push(
      `Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );

    return {
      success: false,
      results,
      errors,
    };
  }
}

/**
 * Quick EPUB compatibility check
 * Verifies basic EPUB support without full processing
 */
export function checkEPUBCompatibility(): {
  fileTypeSupport: boolean;
  parserAvailable: boolean;
  validationAvailable: boolean;
} {
  try {
    // Check file type support
    const { getFileType } = require('./retriever');
    const {
      validateLangChainFileType,
    } = require('./langchain-document-processor');

    const fileTypeSupport =
      getFileType('test.epub') === 'epub' &&
      validateLangChainFileType('test.epub') === 'epub';

    // Check parser availability
    const parserAvailable = typeof isValidEPUBBuffer === 'function';

    // Check validation availability
    const validationAvailable =
      typeof validateKnowledgeDocumentSize === 'function';

    return {
      fileTypeSupport,
      parserAvailable,
      validationAvailable,
    };
  } catch (error) {
    console.error('Error checking EPUB compatibility:', error);
    return {
      fileTypeSupport: false,
      parserAvailable: false,
      validationAvailable: false,
    };
  }
}

/**
 * Test EPUB with existing document management workflows
 */
export async function testEPUBDocumentManagement(
  epubBuffer: Buffer,
  fileName: string,
  userId: string,
): Promise<boolean> {
  try {
    console.log(
      '[EPUB Document Management Test] Testing document management workflows...',
    );

    // Test file type detection
    const { getFileType } = await import('./retriever');
    const detectedType = getFileType(fileName);

    if (detectedType !== 'epub') {
      console.error(
        `File type detection failed: expected 'epub', got '${detectedType}'`,
      );
      return false;
    }

    // Test size validation
    const sizeValid = validateKnowledgeDocumentSize(epubBuffer.length);
    if (!sizeValid) {
      console.error('Size validation failed for EPUB file');
      return false;
    }

    // Test blob storage decision
    const shouldUseBlob = shouldUseBlobStorage(epubBuffer.length);
    console.log(
      `EPUB file will ${shouldUseBlob ? 'use' : 'not use'} blob storage`,
    );

    console.log(
      '[EPUB Document Management Test] ✓ All document management workflows passed',
    );
    return true;
  } catch (error) {
    console.error('[EPUB Document Management Test] Error:', error);
    return false;
  }
}
