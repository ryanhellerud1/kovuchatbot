/**
 * Serverless-compatible EPUB parser
 * This follows the same pattern as pdf-parser-json.ts for consistency
 * Uses built-in Node.js capabilities to extract actual EPUB content
 *
 * EPUB files are ZIP archives containing XHTML files. This parser extracts
 * the actual text content from those files, similar to how PDF parser works.
 */

import { sanitizeTextPreserveFormatting } from '../utils/text-sanitizer';
import { promisify } from 'util';
import { inflate } from 'zlib';
import * as yauzl from 'yauzl';

/**
 * ZIP file structures for parsing EPUB
 */
interface ZipEntry {
  fileName: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  offset: number;
  data: Buffer;
}

/**
 * Extract content from EPUB ZIP archive
 * This function parses the ZIP structure and extracts text from XHTML files
 */
async function extractEPUBContent(buffer: Buffer): Promise<string> {
  try {
    // Parse ZIP central directory to find all files
    const entries = parseZipEntries(buffer);

    // Find content files (typically in OEBPS or similar directory)
    const contentFiles = entries.filter(
      (entry) =>
        entry.fileName.toLowerCase().endsWith('.xhtml') ||
        entry.fileName.toLowerCase().endsWith('.html') ||
        entry.fileName.toLowerCase().endsWith('.htm'),
    );

    if (contentFiles.length === 0) {
      // Try alternative approach - look for any files that might contain text
      console.warn(
        'No standard HTML/XHTML files found, trying alternative file detection',
      );
      const alternativeFiles = entries.filter(
        (entry) =>
          !entry.fileName.toLowerCase().includes('meta-inf') &&
          !entry.fileName.toLowerCase().endsWith('.css') &&
          !entry.fileName.toLowerCase().endsWith('.js') &&
          !entry.fileName.toLowerCase().endsWith('.png') &&
          !entry.fileName.toLowerCase().endsWith('.jpg') &&
          !entry.fileName.toLowerCase().endsWith('.jpeg') &&
          !entry.fileName.toLowerCase().endsWith('.gif') &&
          entry.fileName.includes('.') &&
          entry.uncompressedSize > 100, // Only files with substantial content
      );

      if (alternativeFiles.length === 0) {
        throw new Error(
          'No content files found in EPUB - may be image-only or corrupted',
        );
      }

      contentFiles.push(...alternativeFiles);
      console.log(`Found ${alternativeFiles.length} alternative content files`);
    }

    console.log(`Found ${contentFiles.length} content files in EPUB`);

    // Extract and combine text from all content files
    const textParts: string[] = [];
    let successfulExtractions = 0;
    let failedExtractions = 0;

    for (const entry of contentFiles) {
      try {
        const fileContent = await extractZipEntry(buffer, entry);
        const text = extractTextFromHTML(fileContent.toString('utf8'));
        if (text.trim()) {
          textParts.push(text);
          successfulExtractions++;
          console.log(
            `Successfully extracted ${text.length} characters from ${entry.fileName}`,
          );
        }
      } catch (error) {
        failedExtractions++;
        console.warn(
          `Failed to extract content from ${entry.fileName}:`,
          error,
        );

        // Try alternative extraction methods for corrupted entries
        try {
          const alternativeContent = await extractCorruptedEntry(buffer, entry);
          if (alternativeContent && alternativeContent.trim()) {
            textParts.push(alternativeContent);
            successfulExtractions++;
            console.log(
              `Alternative extraction succeeded for ${entry.fileName}`,
            );
          }
        } catch (altError) {
          console.warn(
            `Alternative extraction also failed for ${entry.fileName}:`,
            altError,
          );
        }
      }
    }

    console.log(
      `EPUB extraction summary: ${successfulExtractions} successful, ${failedExtractions} failed out of ${contentFiles.length} files`,
    );

    if (textParts.length === 0) {
      throw new Error(
        `No readable text content found in EPUB files. Tried ${contentFiles.length} files, all failed extraction.`,
      );
    }

    // If we got some content but many files failed, log a warning
    if (failedExtractions > 0 && textParts.length > 0) {
      console.warn(
        `EPUB partially corrupted: extracted content from ${successfulExtractions}/${contentFiles.length} files`,
      );
    }

    // Combine all text parts
    const combinedText = textParts.join('\n\n');

    console.log(
      `Extracted ${combinedText.length} characters from ${textParts.length} files`,
    );

    return combinedText;
  } catch (error) {
    console.error('Error extracting EPUB content:', error);
    throw error;
  }
}

/**
 * Parse ZIP entries from buffer
 * Simplified ZIP parser for EPUB files
 */
function parseZipEntries(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];

  try {
    // Find end of central directory record
    let eocdOffset = -1;
    for (let i = buffer.length - 22; i >= 0; i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset === -1) {
      throw new Error('Invalid ZIP file - no end of central directory found');
    }

    // Read central directory info
    const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
    const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

    // Parse central directory entries
    let offset = centralDirOffset;
    while (offset < centralDirOffset + centralDirSize) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) {
        break; // Not a central directory entry
      }

      const compressionMethod = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const uncompressedSize = buffer.readUInt32LE(offset + 24);
      const fileNameLength = buffer.readUInt16LE(offset + 28);
      const extraFieldLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localHeaderOffset = buffer.readUInt32LE(offset + 42);

      const fileName = buffer
        .slice(offset + 46, offset + 46 + fileNameLength)
        .toString('utf8');

      entries.push({
        fileName,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        offset: localHeaderOffset,
        data: Buffer.alloc(0), // Will be filled when needed
      });

      offset += 46 + fileNameLength + extraFieldLength + commentLength;
    }

    return entries;
  } catch (error) {
    console.error('Error parsing ZIP entries:', error);
    throw new Error('Failed to parse EPUB ZIP structure');
  }
}

/**
 * Extract a specific ZIP entry with improved error handling
 */
async function extractZipEntry(
  buffer: Buffer,
  entry: ZipEntry,
): Promise<Buffer> {
  try {
    // Read local file header
    const localHeaderOffset = entry.offset;
    if (localHeaderOffset >= buffer.length - 30) {
      throw new Error('Local file header offset beyond buffer bounds');
    }

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error('Invalid local file header signature');
    }

    const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28);

    // Calculate data offset with bounds checking
    const dataOffset =
      localHeaderOffset + 30 + fileNameLength + extraFieldLength;

    if (
      dataOffset >= buffer.length ||
      dataOffset + entry.compressedSize > buffer.length
    ) {
      throw new Error('Data offset beyond buffer bounds');
    }

    const compressedData = buffer.slice(
      dataOffset,
      dataOffset + entry.compressedSize,
    );

    // Validate compressed data size
    if (compressedData.length !== entry.compressedSize) {
      throw new Error(
        `Compressed data size mismatch: expected ${entry.compressedSize}, got ${compressedData.length}`,
      );
    }

    // Decompress if needed
    if (entry.compressionMethod === 0) {
      // No compression - stored
      return compressedData;
    } else if (entry.compressionMethod === 8) {
      // Deflate compression
      try {
        const inflateAsync = promisify(inflate);
        const decompressed = await inflateAsync(compressedData);

        // Validate decompressed size if known
        if (
          entry.uncompressedSize > 0 &&
          decompressed.length !== entry.uncompressedSize
        ) {
          console.warn(
            `Decompressed size mismatch for ${entry.fileName}: expected ${entry.uncompressedSize}, got ${decompressed.length}`,
          );
        }

        return decompressed;
      } catch (inflateError) {
        // Try alternative decompression approach for corrupted data
        console.warn(
          `Standard inflate failed for ${entry.fileName}, trying raw inflate:`,
          inflateError,
        );

        try {
          const { inflateRaw } = await import('zlib');
          const inflateRawAsync = promisify(inflateRaw);
          return await inflateRawAsync(compressedData);
        } catch (rawInflateError) {
          const rawError = rawInflateError as Error;
          const inflateErr = inflateError as Error;
          throw new Error(
            `Both inflate methods failed: ${inflateErr.message} | ${rawError.message}`,
          );
        }
      }
    } else {
      throw new Error(
        `Unsupported compression method: ${entry.compressionMethod}`,
      );
    }
  } catch (error) {
    console.error(`Error extracting ZIP entry ${entry.fileName}:`, error);
    throw error;
  }
}

/**
 * Alternative extraction method for corrupted ZIP entries
 * This tries to extract readable content even from partially corrupted files
 */
async function extractCorruptedEntry(
  buffer: Buffer,
  entry: ZipEntry,
): Promise<string> {
  try {
    // Try to find readable text patterns in the raw compressed data
    const localHeaderOffset = entry.offset;
    if (localHeaderOffset >= buffer.length - 30) {
      throw new Error('Local file header offset beyond buffer bounds');
    }

    const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset =
      localHeaderOffset + 30 + fileNameLength + extraFieldLength;

    if (dataOffset >= buffer.length) {
      throw new Error('Data offset beyond buffer bounds');
    }

    // Get the raw data (compressed or not)
    const rawData = buffer.slice(
      dataOffset,
      Math.min(dataOffset + entry.compressedSize, buffer.length),
    );

    // Try to find HTML-like patterns in the raw data
    const rawText = rawData.toString(
      'utf8',
      0,
      Math.min(rawData.length, 10000),
    ); // Limit to first 10KB

    // Look for HTML content patterns
    const htmlPatterns = [
      /<p[^>]*>([\s\S]*?)<\/p>/gi,
      /<div[^>]*>([\s\S]*?)<\/div>/gi,
      /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi,
      /<span[^>]*>([\s\S]*?)<\/span>/gi,
      /<td[^>]*>([\s\S]*?)<\/td>/gi,
      /<li[^>]*>([\s\S]*?)<\/li>/gi,
    ];

    let extractedText = '';
    for (const pattern of htmlPatterns) {
      const matches = rawText.match(pattern);
      if (matches) {
        for (const match of matches) {
          const cleanMatch = extractTextFromHTML(match);
          if (cleanMatch.trim().length > 10) {
            // Only include substantial text
            extractedText += cleanMatch + '\n';
          }
        }
      }
    }

    // If no HTML patterns found, try to extract readable ASCII text
    if (!extractedText.trim()) {
      const asciiText = rawText.replace(/[^\x20-\x7E\n\r\t]/g, ' '); // Keep only printable ASCII
      const words = asciiText.split(/\s+/).filter((word) => word.length > 2);
      if (words.length > 10) {
        // If we found substantial text
        extractedText = words.join(' ');
      }
    }

    return extractedText.trim();
  } catch (error) {
    console.warn(`Alternative extraction failed for ${entry.fileName}:`, error);
    return '';
  }
}

/**
 * Extract text content from HTML/XHTML
 * Simple HTML parser that extracts text content
 */
function extractTextFromHTML(html: string): string {
  if (!html || typeof html !== 'string') {
    return '';
  }

  let text = html;

  // Remove XML declaration and DOCTYPE
  text = text.replace(/<\?xml[^>]*\?>/gi, '');
  text = text.replace(/<!DOCTYPE[^>]*>/gi, '');

  // Remove script and style tags with their content
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Convert common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Add line breaks for block elements
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]*>/g, ' ');

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');
  text = text.trim();

  return text;
}

/**
 * EPUB metadata interface following the same pattern as PDF parser
 */
interface EPUBMetadata {
  title?: string;
  author?: string[];
  publisher?: string;
  language?: string;
  identifier?: string;
  description?: string;
  rights?: string;
  date?: string;
  totalChapters?: number;
}

/**
 * EPUB chapter interface
 */
interface EPUBChapter {
  id: string;
  title: string;
  content: string;
  order: number;
  href: string;
  wordCount: number;
}

/**
 * Fix common EPUB text extraction issues and apply security sanitization
 * Similar to fixCharacterSpacing in PDF parser but for HTML content
 */
function cleanEPUBText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let cleanedText = text;

  // Step 1: Security - Remove potentially dangerous HTML content
  cleanedText = cleanedText.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ''); // Remove script tags
  cleanedText = cleanedText.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ''); // Remove style tags
  cleanedText = cleanedText.replace(/javascript:/gi, ''); // Remove javascript: URLs
  cleanedText = cleanedText.replace(/on\w+\s*=/gi, ''); // Remove event handlers

  // Step 2: Remove HTML tags and entities
  cleanedText = cleanedText.replace(/<[^>]*>/g, ' '); // Remove HTML tags
  cleanedText = cleanedText.replace(/&nbsp;/g, ' '); // Replace non-breaking spaces
  cleanedText = cleanedText.replace(/&[a-zA-Z0-9#]+;/g, ' '); // Remove HTML entities

  // Step 3: Fix common spacing issues
  cleanedText = cleanedText.replace(/\s+/g, ' '); // Multiple spaces to single space
  cleanedText = cleanedText.replace(/([.!?])\s*([A-Z])/g, '$1 $2'); // Space after sentence endings

  // Step 4: Remove excessive line breaks but preserve paragraph structure
  cleanedText = cleanedText.replace(/\n\s*\n\s*\n/g, '\n\n'); // Multiple line breaks to double

  // Step 5: Apply existing text sanitization for database safety
  cleanedText = sanitizeTextPreserveFormatting(cleanedText);

  // Step 6: Final cleanup
  cleanedText = cleanedText.trim();

  return cleanedText;
}

/**
 * Real EPUB parser that extracts actual text content from EPUB files
 * EPUB files are ZIP archives containing XHTML files - this parser extracts the actual content
 */
export async function parseEPUBWithBuffer(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  try {
    // Validate buffer
    if (!Buffer.isBuffer(buffer)) {
      throw new Error('Invalid buffer provided');
    }

    if (buffer.length === 0) {
      throw new Error('Empty buffer provided');
    }

    // Check if buffer starts with ZIP signature (EPUB is a ZIP file)
    const zipSignature = buffer.slice(0, 4);
    if (!(zipSignature[0] === 0x50 && zipSignature[1] === 0x4b)) {
      throw new Error('Invalid EPUB file - missing ZIP signature');
    }

    console.log(`Parsing EPUB: ${fileName}, size: ${buffer.length} bytes`);

    // Extract actual content from EPUB ZIP archive
    const extractedText = await extractEPUBContent(buffer);

    if (!extractedText || extractedText.length === 0) {
      throw new Error('No text content found in EPUB');
    }

    // Clean and sanitize the extracted text
    const cleanedText = cleanEPUBText(extractedText);
    const sanitizedContent = sanitizeTextPreserveFormatting(cleanedText);

    console.log(
      `EPUB parsed successfully: ${sanitizedContent.length} characters extracted`,
    );

    return sanitizedContent;
  } catch (error) {
    console.error(`Error parsing EPUB ${fileName}:`, error);
    throw error;
  }
}

/**
 * Alternative EPUB parser using simplified approach for serverless compatibility
 * Following the same pattern as parsePDFWithFile but without file system operations
 */
export async function parseEPUBWithFile(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  // In serverless environments, we can't use file system operations
  // So we'll use the same simplified parsing approach
  return parseEPUBWithBuffer(buffer, fileName);
}

/**
 * Robust EPUB parser using yauzl library as fallback
 * This handles corrupted ZIP entries more gracefully
 */
async function parseEPUBWithYauzl(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(new Error(`Failed to open EPUB with yauzl: ${err.message}`));
        return;
      }

      if (!zipfile) {
        reject(new Error('Failed to create zipfile instance'));
        return;
      }

      const textParts: string[] = [];
      let processedEntries = 0;
      let totalContentEntries = 0;
      let successfulExtractions = 0;
      let failedExtractions = 0;

      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        const fileName = entry.fileName.toLowerCase();

        // Check if this is a content file
        const isContentFile =
          fileName.endsWith('.xhtml') ||
          fileName.endsWith('.html') ||
          fileName.endsWith('.htm') ||
          (fileName.includes('.') &&
            !fileName.includes('meta-inf') &&
            !fileName.endsWith('.css') &&
            !fileName.endsWith('.js') &&
            !fileName.endsWith('.png') &&
            !fileName.endsWith('.jpg') &&
            !fileName.endsWith('.jpeg') &&
            !fileName.endsWith('.gif') &&
            entry.uncompressedSize > 100);

        if (isContentFile) {
          totalContentEntries++;

          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
              console.warn(
                `Failed to open stream for ${entry.fileName}:`,
                err.message,
              );
              failedExtractions++;
              processedEntries++;

              if (processedEntries === totalContentEntries) {
                finishProcessing();
              } else {
                zipfile.readEntry();
              }
              return;
            }

            if (!readStream) {
              console.warn(`No read stream for ${entry.fileName}`);
              failedExtractions++;
              processedEntries++;

              if (processedEntries === totalContentEntries) {
                finishProcessing();
              } else {
                zipfile.readEntry();
              }
              return;
            }

            const chunks: Buffer[] = [];

            readStream.on('data', (chunk) => {
              chunks.push(chunk);
            });

            readStream.on('end', () => {
              try {
                const content = Buffer.concat(chunks).toString('utf8');
                const text = extractTextFromHTML(content);

                if (text.trim()) {
                  textParts.push(text);
                  successfulExtractions++;
                  console.log(
                    `Successfully extracted ${text.length} characters from ${entry.fileName}`,
                  );
                }
              } catch (extractError) {
                console.warn(
                  `Failed to extract text from ${entry.fileName}:`,
                  extractError,
                );
                failedExtractions++;
              }

              processedEntries++;

              if (processedEntries === totalContentEntries) {
                finishProcessing();
              } else {
                zipfile.readEntry();
              }
            });

            readStream.on('error', (streamError) => {
              console.warn(
                `Stream error for ${entry.fileName}:`,
                streamError.message,
              );
              failedExtractions++;
              processedEntries++;

              if (processedEntries === totalContentEntries) {
                finishProcessing();
              } else {
                zipfile.readEntry();
              }
            });
          });
        } else {
          // Not a content file, continue to next entry
          zipfile.readEntry();
        }
      });

      zipfile.on('end', () => {
        if (totalContentEntries === 0) {
          reject(new Error('No content files found in EPUB'));
        }
      });

      zipfile.on('error', (zipError) => {
        reject(new Error(`ZIP file error: ${zipError.message}`));
      });

      function finishProcessing() {
        console.log(
          `Yauzl extraction summary: ${successfulExtractions} successful, ${failedExtractions} failed out of ${totalContentEntries} files`,
        );

        if (textParts.length === 0) {
          reject(
            new Error(
              `No readable text content found using yauzl. Tried ${totalContentEntries} files, all failed extraction.`,
            ),
          );
        } else {
          const combinedText = textParts.join('\n\n');
          console.log(
            `Yauzl extracted ${combinedText.length} characters from ${textParts.length} files`,
          );
          resolve(combinedText);
        }
      }
    });
  });
}

/**
 * Main EPUB parsing function that tries multiple approaches
 * Following the same pattern as parsePDFBuffer
 */
export async function parseEPUBBuffer(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  // Validate buffer first
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Invalid buffer provided');
  }

  if (buffer.length === 0) {
    throw new Error('Empty buffer provided');
  }

  // Check if buffer starts with ZIP signature (EPUB is a ZIP file)
  const zipSignature = buffer.slice(0, 4);
  if (!(zipSignature[0] === 0x50 && zipSignature[1] === 0x4b)) {
    throw new Error('Invalid EPUB file - missing ZIP signature');
  }

  console.log(
    `Attempting to parse EPUB: ${fileName}, size: ${buffer.length} bytes`,
  );

  // Try buffer-based parsing first (faster)
  try {
    return await parseEPUBWithBuffer(buffer, fileName);
  } catch (error) {
    const bufferError = error as Error;
    console.warn('Buffer-based EPUB parsing failed:', bufferError.message);

    // Try yauzl library as fallback for corrupted ZIP files
    try {
      console.log('Attempting yauzl-based EPUB parsing for corrupted ZIP...');
      const yauzlResult = await parseEPUBWithYauzl(buffer, fileName);

      // If yauzl succeeded, clean and return the result
      const cleanedText = cleanEPUBText(yauzlResult);
      const sanitizedContent = sanitizeTextPreserveFormatting(cleanedText);
      console.log(
        `Yauzl parsing successful: ${sanitizedContent.length} characters extracted`,
      );
      return sanitizedContent;
    } catch (yauzlError) {
      const yauzlErr = yauzlError as Error;
      console.warn('Yauzl-based EPUB parsing failed:', yauzlErr.message);

      // If yauzl fails, try file-based approach as final fallback
      try {
        console.log('Attempting file-based EPUB parsing...');
        return await parseEPUBWithFile(buffer, fileName);
      } catch (error) {
        const fileError = error as Error;
        console.error(
          'File-based EPUB parsing also failed:',
          fileError.message,
        );

        // All methods failed, provide comprehensive error message
        throw new Error(
          `EPUB parsing failed with all methods. Errors: 1) Custom parser: ${bufferError.message} 2) Yauzl parser: ${yauzlErr.message} 3) File parser: ${fileError.message}. This EPUB may be severely corrupted, password-protected, or contain only images. Please try a different EPUB or convert to text format.`,
        );
      }
    }
  }
}

/**
 * Enhanced EPUB parsing result with metadata
 */
export interface EPUBParseResult {
  content: string;
  metadata: EPUBMetadata;
  chapters: EPUBChapter[];
}

/**
 * Parse EPUB buffer and return content with metadata (simplified version)
 * This function provides enhanced metadata for document processing
 */
export async function parseEPUBWithMetadata(
  buffer: Buffer,
  fileName: string,
): Promise<EPUBParseResult> {
  try {
    // Get the basic content using our simplified parser
    const content = await parseEPUBBuffer(buffer, fileName);

    // Create placeholder metadata since we can't parse the full EPUB structure yet
    const title = fileName.replace(/\.[^/.]+$/, '');
    const metadata: EPUBMetadata = {
      title,
      author: ['Unknown Author'],
      publisher: 'Unknown Publisher',
      language: 'en',
      identifier: `epub-${Date.now()}`,
      description: `EPUB document: ${title}`,
      totalChapters: 1, // Placeholder since we can't parse chapters yet
    };

    // Create a single placeholder chapter
    const chapters: EPUBChapter[] = [
      {
        id: 'chapter-1',
        title: title,
        content,
        order: 0,
        href: 'content.html',
        wordCount: content.split(/\s+/).length,
      },
    ];

    console.log(
      `EPUB metadata generated: ${content.length} characters, ${chapters.length} chapters`,
    );

    return {
      content,
      metadata,
      chapters,
    };
  } catch (error) {
    console.error(`Error parsing EPUB with metadata ${fileName}:`, error);
    throw error;
  }
}

/**
 * Check if a buffer is a valid EPUB
 * Following the same pattern as isValidPDFBuffer
 */
export function isValidEPUBBuffer(buffer: Buffer): boolean {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return false;
  }

  // Check for ZIP signature (EPUB is a ZIP file)
  const zipSignature = buffer.slice(0, 4);
  return zipSignature[0] === 0x50 && zipSignature[1] === 0x4b;
}
