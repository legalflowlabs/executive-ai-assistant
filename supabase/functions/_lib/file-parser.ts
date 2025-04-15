/**
 * File parser module for converting various document types to text
 * Based on the Marker project approach for document conversion
 */

import { processMarkdown, ProcessedMd } from './markdown-parser';
import { getFileExtension, getMimeType, log } from './utils';

/**
 * Supported file types for conversion
 */
export type SupportedFileType = 
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'html'
  | 'epub'
  | 'txt'
  | 'md'
  | 'image'; // Covers various image formats

/**
 * Configuration options for file parsing
 */
export interface FileParserOptions {
  /** Maximum section length for chunking */
  maxSectionLength?: number;
  /** Whether to extract images from documents */
  extractImages?: boolean;
  /** Whether to force OCR on PDFs */
  forceOcr?: boolean;
  /** Whether to strip existing OCR text */
  stripExistingOcr?: boolean;
  /** Whether to use LLM for improved accuracy */
  useLlm?: boolean;
  /** Whether to redo inline math conversion */
  redoInlineMath?: boolean;
  /** Whether to paginate output */
  paginateOutput?: boolean;
  /** Whether to process as markdown (default: true) */
  processAsMarkdown?: boolean;
}

/**
 * Result of file parsing operation
 */
export interface FileParseResult {
  /** Processed markdown content */
  processed: ProcessedMd;
  /** Original file type */
  fileType: SupportedFileType;
  /** MIME type of the file */
  mimeType: string;
  /** Any extracted images (if enabled) */
  images?: string[];
  /** Error message if parsing failed */
  error?: string;
}

/**
 * Determines if a file type is supported for conversion
 * @param fileExt - File extension to check
 * @returns Whether the file type is supported
 */
export function isSupportedFileType(fileExt: string): fileExt is SupportedFileType {
  const supportedTypes: SupportedFileType[] = [
    'pdf', 'docx', 'pptx', 'xlsx', 'html', 'epub', 'txt', 'md', 'image'
  ];
  
  // Handle image types
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'tiff', 'bmp'].includes(fileExt)) {
    return true;
  }
  
  return supportedTypes.includes(fileExt as SupportedFileType);
}

/**
 * Converts a document file to text content
 * @param fileContent - Binary content of the file
 * @param fileName - Name of the file (used to determine type)
 * @param options - Parsing options
 * @returns Processed markdown content and metadata
 */
export async function parseFile(
  fileContent: Uint8Array,
  fileName: string,
  options: FileParserOptions = {}
): Promise<FileParseResult> {
  const fileExt = getFileExtension(fileName);
  const mimeType = getMimeType(fileExt);
  
  // Default options
  const {
    maxSectionLength = 2500,
    extractImages = true,
    forceOcr = false,
    stripExistingOcr = false,
    useLlm = false,
    redoInlineMath = false,
    paginateOutput = false,
    processAsMarkdown = true
  } = options;
  
  // Check if file type is supported
  if (!isSupportedFileType(fileExt)) {
    log(`Unsupported file type: ${fileExt}`, 'error');
    return {
      processed: { sections: [] },
      fileType: 'txt' as SupportedFileType,
      mimeType,
      error: `Unsupported file type: ${fileExt}`
    };
  }
  
  try {
    // Send the file to the Marker API for processing
    let textContent = '';
    
    // For text-based formats, we can use the content directly without API
    if (fileExt === 'md' || fileExt === 'txt') {
      textContent = new TextDecoder().decode(fileContent);
    } else {
      // For all other formats, send to Marker API
      textContent = await processWithMarkerAPI(fileContent, fileName, mimeType, {
        forceOcr,
        stripExistingOcr,
        extractImages,
        useLlm
      });
    }
    
    // Apply pagination if requested
    if (paginateOutput) {
      textContent = applyPagination(textContent);
    }
    
    // Process the text content - either as markdown or plain text
    const processed = processAsMarkdown 
      ? processMarkdown(textContent, maxSectionLength)
      : { sections: [{ content: textContent }] };
    
    // Return the processed content and metadata
    return {
      processed,
      fileType: fileExt as SupportedFileType,
      mimeType,
      images: extractImages ? [] : undefined // Marker API already handles image extraction
    };
  } catch (error) {
    log(`Error parsing file: ${error instanceof Error ? error.message : String(error)}`, 'error');
    return {
      processed: { sections: [] },
      fileType: fileExt as SupportedFileType,
      mimeType,
      error: `Error parsing file: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Processes a file with the Marker API service
 * @param fileContent - Binary content of the file
 * @param fileName - Name of the file
 * @param mimeType - MIME type of the file
 * @param options - Options for the Marker API
 * @returns Extracted text content from the file
 */
async function processWithMarkerAPI(
  fileContent: Uint8Array,
  fileName: string,
  mimeType: string,
  options: {
    forceOcr: boolean;
    stripExistingOcr: boolean;
    extractImages: boolean;
    useLlm: boolean;
  }
): Promise<string> {
  const markerApiUrl = process.env.MARKER_SERVICE_URL;
  if (!markerApiUrl) {
    throw new Error('Marker API URL is not defined');
  }
  
  // Create form data with file and options
  const formData = new FormData();
  const blob = new Blob([fileContent], { type: mimeType });
  formData.append('file', blob, fileName);
  formData.append('options', JSON.stringify(options));
  
  // Send request to Marker API
  try {
    const response = await fetch(markerApiUrl, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`Marker API error: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    log(`Successfully processed ${fileName} with Marker API`, 'info');
    return result.text;
  } catch (apiError) {
    log(`Error calling Marker API: ${apiError instanceof Error ? apiError.message : String(apiError)}`, 'error');
    throw apiError;
  }
}

/**
 * Applies pagination to text content
 * @param content - The text content to paginate
 * @returns Paginated text content
 */
function applyPagination(content: string): string {
  // This is a simplified pagination implementation
  // In a real implementation, this would detect actual page breaks
  const pageSize = 3000; // Characters per page
  const pages = [];
  
  for (let i = 0; i < content.length; i += pageSize) {
    const pageContent = content.substring(i, i + pageSize);
    pages.push(pageContent);
  }
  
  return pages.map((page, index) => {
    const pageNumber = index + 1;
    return `${page}\n\n${pageNumber}\n${'-'.repeat(48)}\n\n`;
  }).join('');
}