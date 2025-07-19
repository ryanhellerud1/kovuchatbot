/**
 * EPUB parser using epub2 library
 * This follows the same pattern as pdf-parser-json.ts for consistency
 */

import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sanitizeTextPreserveFormatting } from '../utils/text-sanitizer';

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
  cleanedText = cleanedText.replace(/<script[^>]*>.*?<\/script>/gis, ''); // Remove script tags
  cleanedText = cleanedText.replace(/<style[^>]*>.*?<\/style>/gis, ''); // Remove style tags
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
 * Parse EPUB buffer using epub2 library
 * Following the same pattern as parsePDFWithJson
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

    console.log(
      `Parsing EPUB with epub2: ${fileName}, size: ${buffer.length} bytes`,
    );

    // Dynamic import to avoid bundling issues
    const EPub = (await import('epub2')).default;

    return new Promise((resolve, reject) => {
      const epub = new EPub(buffer);

      let extractedText = '';
      const chapters: EPUBChapter[] = [];

      // Set up event handlers
      epub.on('error', (error: any) => {
        console.error('EPUB parsing error:', error);
        reject(
          new Error(`EPUB parsing failed: ${error.message || 'Unknown error'}`),
        );
      });

      epub.on('end', async () => {
        try {
          // Extract metadata
          const metadata: EPUBMetadata = {
            title: epub.metadata.title || fileName.replace(/\.[^/.]+$/, ''),
            author: epub.metadata.creator ? [epub.metadata.creator] : [],
            publisher: epub.metadata.publisher,
            language: epub.metadata.language,
            identifier: epub.metadata.identifier,
            description: epub.metadata.description,
            rights: epub.metadata.rights,
            date: epub.metadata.date,
            totalChapters: 0,
          };

          // Get chapter list
          const flow = epub.flow || [];
          metadata.totalChapters = flow.length;

          // Extract text from each chapter
          const textParts: string[] = [];

          for (let i = 0; i < flow.length; i++) {
            const chapter = flow[i];

            try {
              const chapterText = await new Promise<string>(
                (resolveChapter, rejectChapter) => {
                  epub.getChapter(chapter.id, (error: any, text: string) => {
                    if (error) {
                      console.warn(
                        `Failed to extract chapter ${chapter.id}:`,
                        error,
                      );
                      resolveChapter(''); // Continue with empty content rather than failing
                    } else {
                      resolveChapter(text || '');
                    }
                  });
                },
              );

              if (chapterText) {
                // Clean the HTML content
                const cleanedText = cleanEPUBText(chapterText);

                if (cleanedText.trim()) {
                  textParts.push(cleanedText);

                  chapters.push({
                    id: chapter.id,
                    title: chapter.title || `Chapter ${i + 1}`,
                    content: cleanedText,
                    order: i,
                    href: chapter.href || '',
                    wordCount: cleanedText.split(/\s+/).length,
                  });
                }
              }
            } catch (chapterError) {
              console.warn(
                `Error processing chapter ${chapter.id}:`,
                chapterError,
              );
              // Continue processing other chapters
            }
          }

          // Join all chapter text
          const rawText = textParts.join('\n\n').trim();

          // Sanitize text to remove null bytes and other unwanted characters
          const sanitizedText = sanitizeTextPreserveFormatting(rawText);

          extractedText = sanitizedText;

          if (!extractedText || extractedText.length === 0) {
            reject(new Error('No text content found in EPUB'));
            return;
          }

          console.log(
            `EPUB parsed successfully: ${extractedText.length} characters extracted from ${chapters.length} chapters`,
          );
          resolve(extractedText);
        } catch (processingError) {
          console.error('Error processing EPUB data:', processingError);
          reject(new Error('Failed to process EPUB content'));
        }
      });

      // Start parsing
      try {
        epub.parse();
      } catch (parseError) {
        console.error('Error starting EPUB parse:', parseError);
        reject(new Error('Failed to start EPUB parsing'));
      }
    });
  } catch (error) {
    console.error(`Error parsing EPUB ${fileName}:`, error);
    throw error;
  }
}

/**
 * Alternative EPUB parser using file-based approach for compatibility
 * Following the same pattern as parsePDFWithFile
 */
export async function parseEPUBWithFile(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const tempDir = tmpdir();
  const tempEpubPath = join(
    tempDir,
    `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.epub`,
  );

  try {
    // Write buffer to temporary file
    writeFileSync(tempEpubPath, buffer);

    console.log(
      `Parsing EPUB from file: ${fileName}, size: ${buffer.length} bytes`,
    );

    // Dynamic import to avoid bundling issues
    const EPub = (await import('epub2')).default;

    return new Promise((resolve, reject) => {
      const epub = new EPub(tempEpubPath);

      // Set up event handlers
      epub.on('error', (error: any) => {
        console.error('EPUB parsing error:', error);
        // Clean up temp file
        try {
          unlinkSync(tempEpubPath);
        } catch (cleanupError) {
          console.warn('Failed to clean up temp file:', cleanupError);
        }
        reject(
          new Error(`EPUB parsing failed: ${error.message || 'Unknown error'}`),
        );
      });

      epub.on('end', async () => {
        try {
          // Clean up temp file first
          try {
            unlinkSync(tempEpubPath);
          } catch (cleanupError) {
            console.warn('Failed to clean up temp file:', cleanupError);
          }

          // Extract text from chapters
          const flow = epub.flow || [];
          const textParts: string[] = [];

          for (let i = 0; i < flow.length; i++) {
            const chapter = flow[i];

            try {
              const chapterText = await new Promise<string>(
                (resolveChapter) => {
                  epub.getChapter(chapter.id, (error: any, text: string) => {
                    if (error) {
                      console.warn(
                        `Failed to extract chapter ${chapter.id}:`,
                        error,
                      );
                      resolveChapter('');
                    } else {
                      resolveChapter(text || '');
                    }
                  });
                },
              );

              if (chapterText) {
                const cleanedText = cleanEPUBText(chapterText);
                if (cleanedText.trim()) {
                  textParts.push(cleanedText);
                }
              }
            } catch (chapterError) {
              console.warn(
                `Error processing chapter ${chapter.id}:`,
                chapterError,
              );
            }
          }

          const rawText = textParts.join('\n\n').trim();
          const sanitizedText = sanitizeTextPreserveFormatting(rawText);

          if (!sanitizedText || sanitizedText.length === 0) {
            reject(new Error('No text content found in EPUB'));
            return;
          }

          console.log(
            `EPUB parsed successfully: ${sanitizedText.length} characters extracted`,
          );
          resolve(sanitizedText);
        } catch (processingError) {
          console.error('Error processing EPUB data:', processingError);
          reject(new Error('Failed to process EPUB content'));
        }
      });

      // Start parsing from file
      try {
        epub.parse();
      } catch (parseError) {
        console.error('Error loading EPUB file:', parseError);
        // Clean up temp file
        try {
          unlinkSync(tempEpubPath);
        } catch (cleanupError) {
          console.warn('Failed to clean up temp file:', cleanupError);
        }
        reject(new Error('Failed to load EPUB file'));
      }
    });
  } catch (error) {
    // Clean up temp file on error
    try {
      unlinkSync(tempEpubPath);
    } catch (cleanupError) {
      console.warn('Failed to clean up temp file:', cleanupError);
    }
    throw error;
  }
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

    // If buffer parsing fails, try file-based approach
    try {
      console.log('Attempting file-based EPUB parsing...');
      return await parseEPUBWithFile(buffer, fileName);
    } catch (error) {
      const fileError = error as Error;
      console.error('File-based EPUB parsing also failed:', fileError.message);

      // Both methods failed, provide helpful error message
      throw new Error(
        `EPUB parsing failed with both methods. Error details: ${bufferError.message}. This EPUB may be corrupted, password-protected, or contain only images. Please try a different EPUB or convert to text format.`,
      );
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
 * Parse EPUB buffer and return content with metadata
 * This function provides enhanced metadata for document processing
 */
export async function parseEPUBWithMetadata(
  buffer: Buffer,
  fileName: string,
): Promise<EPUBParseResult> {
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

    console.log(
      `Parsing EPUB with metadata: ${fileName}, size: ${buffer.length} bytes`,
    );

    // Dynamic import to avoid bundling issues
    const EPub = (await import('epub2')).default;

    return new Promise((resolve, reject) => {
      const epub = new EPub(buffer);

      // Set up event handlers
      epub.on('error', (error: any) => {
        console.error('EPUB parsing error:', error);
        reject(
          new Error(`EPUB parsing failed: ${error.message || 'Unknown error'}`),
        );
      });

      epub.on('end', async () => {
        try {
          // Extract metadata
          const metadata: EPUBMetadata = {
            title: epub.metadata.title || fileName.replace(/\.[^/.]+$/, ''),
            author: epub.metadata.creator ? [epub.metadata.creator] : [],
            publisher: epub.metadata.publisher,
            language: epub.metadata.language,
            identifier: epub.metadata.identifier,
            description: epub.metadata.description,
            rights: epub.metadata.rights,
            date: epub.metadata.date,
            totalChapters: 0,
          };

          // Get chapter list
          const flow = epub.flow || [];
          metadata.totalChapters = flow.length;

          // Extract text from each chapter
          const textParts: string[] = [];
          const chapters: EPUBChapter[] = [];

          for (let i = 0; i < flow.length; i++) {
            const chapter = flow[i];

            try {
              const chapterText = await new Promise<string>(
                (resolveChapter) => {
                  epub.getChapter(chapter.id, (error: any, text: string) => {
                    if (error) {
                      console.warn(
                        `Failed to extract chapter ${chapter.id}:`,
                        error,
                      );
                      resolveChapter('');
                    } else {
                      resolveChapter(text || '');
                    }
                  });
                },
              );

              if (chapterText) {
                // Clean the HTML content
                const cleanedText = cleanEPUBText(chapterText);

                if (cleanedText.trim()) {
                  textParts.push(cleanedText);

                  chapters.push({
                    id: chapter.id,
                    title: chapter.title || `Chapter ${i + 1}`,
                    content: cleanedText,
                    order: i,
                    href: chapter.href || '',
                    wordCount: cleanedText.split(/\s+/).length,
                  });
                }
              }
            } catch (chapterError) {
              console.warn(
                `Error processing chapter ${chapter.id}:`,
                chapterError,
              );
              // Continue processing other chapters
            }
          }

          // Join all chapter text
          const rawText = textParts.join('\n\n').trim();

          // Sanitize text to remove null bytes and other unwanted characters
          const content = sanitizeTextPreserveFormatting(rawText);

          if (!content || content.length === 0) {
            reject(new Error('No text content found in EPUB'));
            return;
          }

          console.log(
            `EPUB parsed successfully: ${content.length} characters extracted from ${chapters.length} chapters`,
          );

          resolve({
            content,
            metadata,
            chapters,
          });
        } catch (processingError) {
          console.error('Error processing EPUB data:', processingError);
          reject(new Error('Failed to process EPUB content'));
        }
      });

      // Start parsing
      try {
        epub.parse();
      } catch (parseError) {
        console.error('Error starting EPUB parse:', parseError);
        reject(new Error('Failed to start EPUB parsing'));
      }
    });
  } catch (error) {
    console.error(`Error parsing EPUB ${fileName}:`, error);
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
