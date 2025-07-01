/**
 * Text sanitization utilities for database storage
 * Handles null bytes and other problematic characters that PostgreSQL can't handle
 */

/**
 * Remove null bytes and other problematic characters from text
 * PostgreSQL doesn't allow null bytes (0x00) in text fields
 */
export function sanitizeTextForDatabase(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    // Remove null bytes (0x00) - PostgreSQL doesn't allow these
    .replace(/\x00/g, '')
    // Remove other control characters except newlines, tabs, and carriage returns
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Replace multiple consecutive whitespace with single space
    .replace(/\s+/g, ' ')
    // Trim whitespace from start and end
    .trim();
}

/**
 * Sanitize text content while preserving formatting
 * More conservative approach that keeps line breaks and basic formatting
 */
export function sanitizeTextPreserveFormatting(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    // Remove null bytes (0x00) - PostgreSQL doesn't allow these
    .replace(/\x00/g, '')
    // Remove other problematic control characters but keep \n, \r, \t
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize line endings to \n
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove excessive consecutive newlines (more than 3)
    .replace(/\n{4,}/g, '\n\n\n')
    // Trim whitespace from start and end
    .trim();
}

/**
 * Sanitize metadata object recursively
 * Ensures all string values in metadata are safe for database storage
 */
export function sanitizeMetadata(metadata: any): any {
  if (metadata === null || metadata === undefined) {
    return metadata;
  }

  if (typeof metadata === 'string') {
    return sanitizeTextForDatabase(metadata);
  }

  if (Array.isArray(metadata)) {
    return metadata.map(item => sanitizeMetadata(item));
  }

  if (typeof metadata === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(metadata)) {
      // Sanitize both key and value
      const sanitizedKey = sanitizeTextForDatabase(key);
      sanitized[sanitizedKey] = sanitizeMetadata(value);
    }
    return sanitized;
  }

  return metadata;
}

/**
 * Validate that text is safe for database storage
 * Returns true if text contains no problematic characters
 */
export function isTextSafeForDatabase(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return true;
  }

  // Check for null bytes and other problematic characters
  return !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text);
}

/**
 * Get information about problematic characters in text
 * Useful for debugging text sanitization issues
 */
export function analyzeTextProblems(text: string): {
  hasNullBytes: boolean;
  hasControlChars: boolean;
  nullByteCount: number;
  controlCharCount: number;
  problematicChars: string[];
} {
  if (!text || typeof text !== 'string') {
    return {
      hasNullBytes: false,
      hasControlChars: false,
      nullByteCount: 0,
      controlCharCount: 0,
      problematicChars: [],
    };
  }

  const nullByteMatches = text.match(/\x00/g);
  const controlCharMatches = text.match(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g);
  
  const nullByteCount = nullByteMatches ? nullByteMatches.length : 0;
  const controlCharCount = controlCharMatches ? controlCharMatches.length : 0;
  
  const problematicChars = [
    ...(nullByteMatches || []),
    ...(controlCharMatches || [])
  ].filter((char, index, array) => array.indexOf(char) === index); // unique

  return {
    hasNullBytes: nullByteCount > 0,
    hasControlChars: controlCharCount > 0,
    nullByteCount,
    controlCharCount,
    problematicChars,
  };
}

/**
 * Sanitize document chunk content and metadata
 * Comprehensive sanitization for document processing
 */
export function sanitizeDocumentChunk(chunk: {
  content: string;
  metadata?: any;
}): {
  content: string;
  metadata?: any;
} {
  return {
    content: sanitizeTextPreserveFormatting(chunk.content),
    metadata: chunk.metadata ? sanitizeMetadata(chunk.metadata) : undefined,
  };
}

/**
 * Sanitize full document content
 * Used for the main document content field
 */
export function sanitizeDocumentContent(content: string): string {
  return sanitizeTextPreserveFormatting(content);
}

/**
 * Log text sanitization statistics
 * Useful for monitoring and debugging
 */
export function logSanitizationStats(
  originalText: string,
  sanitizedText: string,
  context = 'text'
): void {
  const problems = analyzeTextProblems(originalText);
  
  if (problems.hasNullBytes || problems.hasControlChars) {
    console.log(`[TextSanitizer] Sanitized ${context}:`);
    console.log(`  Original length: ${originalText.length}`);
    console.log(`  Sanitized length: ${sanitizedText.length}`);
    console.log(`  Null bytes removed: ${problems.nullByteCount}`);
    console.log(`  Control chars removed: ${problems.controlCharCount}`);
    
    if (problems.problematicChars.length > 0 && problems.problematicChars.length <= 10) {
      console.log(`  Problematic chars: ${problems.problematicChars.map(c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(', ')}`);
    }
  }
}