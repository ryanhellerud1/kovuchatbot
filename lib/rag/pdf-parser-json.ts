/**
 * PDF parser using pdf2json library
 * This provides better Next.js compatibility than pdf-parse
 */

import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Parse PDF buffer using pdf2json
 */
export async function parsePDFWithJson(
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

    // Check if buffer starts with PDF signature
    const pdfSignature = buffer.slice(0, 4).toString();
    if (pdfSignature !== '%PDF') {
      throw new Error('Invalid PDF file - missing PDF signature');
    }

    console.log(
      `Parsing PDF with pdf2json: ${fileName}, size: ${buffer.length} bytes`,
    );

    // Dynamic import to avoid bundling issues
    const PDFParser = (await import('pdf2json')).default;

    return new Promise((resolve, reject) => {
      const pdfParser = new (PDFParser as any)(null, 1);

      let extractedText = '';

      // Set up event handlers
      pdfParser.on('pdfParser_dataError', (errData: any) => {
        console.error('PDF parsing error:', errData);
        reject(
          new Error(
            `PDF parsing failed: ${errData.parserError || 'Unknown error'}`,
          ),
        );
      });

      pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
        try {
          // Extract text from the parsed data
          if (pdfData && pdfData.Pages && Array.isArray(pdfData.Pages)) {
            const textParts: string[] = [];

            for (const page of pdfData.Pages) {
              if (page.Texts && Array.isArray(page.Texts)) {
                for (const textItem of page.Texts) {
                  if (textItem.R && Array.isArray(textItem.R)) {
                    for (const run of textItem.R) {
                      if (run.T) {
                        // Decode URI component to handle special characters
                        const decodedText = decodeURIComponent(run.T);
                        textParts.push(decodedText);
                      }
                    }
                  }
                }
              }
            }

            extractedText = textParts.join(' ').trim();

            if (!extractedText || extractedText.length === 0) {
              reject(new Error('No text content found in PDF'));
              return;
            }

            console.log(
              `PDF parsed successfully: ${extractedText.length} characters extracted`,
            );
            resolve(extractedText);
          } else {
            reject(new Error('Invalid PDF structure - no pages found'));
          }
        } catch (processingError) {
          console.error('Error processing PDF data:', processingError);
          reject(new Error('Failed to process PDF content'));
        }
      });

      // Parse the buffer directly
      try {
        pdfParser.parseBuffer(buffer);
      } catch (parseError) {
        console.error('Error starting PDF parse:', parseError);
        reject(new Error('Failed to start PDF parsing'));
      }
    });
  } catch (error) {
    console.error(`Error parsing PDF ${fileName}:`, error);
    throw error;
  }
}

/**
 * Alternative PDF parser using file-based approach for compatibility
 */
export async function parsePDFWithFile(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const tempDir = tmpdir();
  const tempPdfPath = join(
    tempDir,
    `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.pdf`,
  );

  try {
    // Write buffer to temporary file
    writeFileSync(tempPdfPath, buffer);

    console.log(
      `Parsing PDF from file: ${fileName}, size: ${buffer.length} bytes`,
    );

    // Dynamic import to avoid bundling issues
    const PDFParser = (await import('pdf2json')).default;

    return new Promise((resolve, reject) => {
      const pdfParser = new (PDFParser as any)(null, 1);

      // Set up event handlers
      pdfParser.on('pdfParser_dataError', (errData: any) => {
        console.error('PDF parsing error:', errData);
        // Clean up temp file
        try {
          unlinkSync(tempPdfPath);
        } catch (cleanupError) {
          console.warn('Failed to clean up temp file:', cleanupError);
        }
        reject(
          new Error(
            `PDF parsing failed: ${errData.parserError || 'Unknown error'}`,
          ),
        );
      });

      pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
        try {
          // Clean up temp file first
          try {
            unlinkSync(tempPdfPath);
          } catch (cleanupError) {
            console.warn('Failed to clean up temp file:', cleanupError);
          }

          // Extract text from the parsed data
          if (pdfData && pdfData.Pages && Array.isArray(pdfData.Pages)) {
            const textParts: string[] = [];

            for (const page of pdfData.Pages) {
              if (page.Texts && Array.isArray(page.Texts)) {
                for (const textItem of page.Texts) {
                  if (textItem.R && Array.isArray(textItem.R)) {
                    for (const run of textItem.R) {
                      if (run.T) {
                        // Decode URI component to handle special characters
                        const decodedText = decodeURIComponent(run.T);
                        textParts.push(decodedText);
                      }
                    }
                  }
                }
              }
            }

            const extractedText = textParts.join(' ').trim();

            if (!extractedText || extractedText.length === 0) {
              reject(new Error('No text content found in PDF'));
              return;
            }

            console.log(
              `PDF parsed successfully: ${extractedText.length} characters extracted`,
            );
            resolve(extractedText);
          } else {
            reject(new Error('Invalid PDF structure - no pages found'));
          }
        } catch (processingError) {
          console.error('Error processing PDF data:', processingError);
          reject(new Error('Failed to process PDF content'));
        }
      });

      // Load from file
      try {
        pdfParser.loadPDF(tempPdfPath);
      } catch (parseError) {
        console.error('Error loading PDF file:', parseError);
        // Clean up temp file
        try {
          unlinkSync(tempPdfPath);
        } catch (cleanupError) {
          console.warn('Failed to clean up temp file:', cleanupError);
        }
        reject(new Error('Failed to load PDF file'));
      }
    });
  } catch (error) {
    // Clean up temp file on error
    try {
      unlinkSync(tempPdfPath);
    } catch (cleanupError) {
      console.warn('Failed to clean up temp file:', cleanupError);
    }
    throw error;
  }
}

/**
 * Main PDF parsing function that tries multiple approaches
 */
export async function parsePDFBuffer(
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

  // Check if buffer starts with PDF signature
  const pdfSignature = buffer.slice(0, 4).toString();
  if (pdfSignature !== '%PDF') {
    throw new Error('Invalid PDF file - missing PDF signature');
  }

  console.log(
    `Attempting to parse PDF: ${fileName}, size: ${buffer.length} bytes`,
  );

  // Try buffer-based parsing first (faster)
  try {
    return await parsePDFWithJson(buffer, fileName);
  } catch (error) {
    const bufferError = error as Error;
    console.warn('Buffer-based PDF parsing failed:', bufferError.message);

    // If buffer parsing fails, try file-based approach
    try {
      console.log('Attempting file-based PDF parsing...');
      return await parsePDFWithFile(buffer, fileName);
    } catch (error) {
      const fileError = error as Error;
      console.error('File-based PDF parsing also failed:', fileError.message);

      // Both methods failed, provide helpful error message
      throw new Error(
        `PDF parsing failed with both methods. Error details: ${bufferError.message}. ` +
          'This PDF may be corrupted, password-protected, or contain only images. ' +
          'Please try a different PDF or convert to text format.',
      );
    }
  }
}

/**
 * Check if a buffer is a valid PDF
 */
export function isValidPDFBuffer(buffer: Buffer): boolean {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return false;
  }

  return buffer.slice(0, 4).toString() === '%PDF';
}
