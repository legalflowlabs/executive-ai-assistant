/**
 * Text extraction module for document processing
 */
import { getMimeType, log } from "./utils.ts";
import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/+esm";
import { extract } from "https://deno.land/x/mammoth@v1.4.0/mod.ts";

// Environment variables
const LLAMAINDEX_API_KEY = Deno.env.get("LLAMAINDEX_API_KEY");
const LLAMAINDEX_API_URL = Deno.env.get("LLAMAINDEX_API_URL") || "https://api.llamaindex.ai/v1";

/**
 * Main text extraction function that uses LlamaIndex with fallback
 * @param fileBytes - The file content as Uint8Array
 * @param fileName - The name of the file
 * @returns Extracted text content
 */
export async function extractText(fileBytes: Uint8Array, fileName: string): Promise<string> {
  return extractTextWithLlamaIndex(fileBytes, fileName);
}

/**
 * Extract text using LlamaIndex API with fallback to local extraction
 * @param fileBytes - The file content as Uint8Array
 * @param fileName - The name of the file
 * @returns Extracted text content
 */
async function extractTextWithLlamaIndex(fileBytes: Uint8Array, fileName: string): Promise<string> {
  if (!LLAMAINDEX_API_KEY) {
    log("LLAMAINDEX_API_KEY not set, falling back to local extraction", "warn");
    return extractTextWithFallback(fileBytes, fileName);
  }
  
  try {
    // Convert file bytes to base64
    const base64File = btoa(String.fromCharCode(...new Uint8Array(fileBytes)));
    
    // Get file extension to determine document type
    const fileExt = fileName.split('.').pop()?.toLowerCase() || "";
    
    // Prepare request to LlamaIndex API
    const response = await fetch(`${LLAMAINDEX_API_URL}/document/parse`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LLAMAINDEX_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        file: {
          data: base64File,
          mime_type: getMimeType(fileExt),
          file_name: fileName
        },
        parsing_options: {
          extract_metadata: true,
          extract_tables: true,
          extract_images: false,
          extract_sections: true
        }
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      log(`LlamaIndex API error: ${JSON.stringify(errorData)}`, "error");
      return extractTextWithFallback(fileBytes, fileName);
    }
    
    const result = await response.json();
    
    // Extract text from the parsed document
    let extractedText = "";
    
    // Process sections if available
    if (result.sections && result.sections.length > 0) {
      extractedText = result.sections.map((section: any) => {
        let sectionText = section.text || "";
        
        // Add section title if available
        if (section.title) {
          sectionText = `${section.title}\n\n${sectionText}`;
        }
        
        return sectionText;
      }).join("\n\n");
    } else if (result.text) {
      // Use plain text if sections not available
      extractedText = result.text;
    }
    
    // Process tables if available and append to text
    if (result.tables && result.tables.length > 0) {
      const tablesText = result.tables.map((table: any) => {
        return `Table: ${table.title || 'Untitled'}\n${table.text || JSON.stringify(table.data)}`;
      }).join("\n\n");
      
      extractedText += "\n\n" + tablesText;
    }
    
    // If we got text, return it
    if (extractedText.trim()) {
      log(`Successfully extracted text using LlamaIndex API: ${extractedText.length} characters`, "info");
      return extractedText;
    }
    
    // If no text was extracted, fall back to local extraction
    log("LlamaIndex API returned empty text, falling back to local extraction", "warn");
    return extractTextWithFallback(fileBytes, fileName);
  } catch (error) {
    log(`Error using LlamaIndex API: ${error.message}. Falling back to local extraction.`, "error");
    return extractTextWithFallback(fileBytes, fileName);
  }
}

/**
 * Fallback text extraction function using PDF.js and basic methods
 * @param fileBytes - The file content as Uint8Array
 * @param fileName - The name of the file
 * @returns Extracted text content
 */
async function extractTextWithFallback(fileBytes: Uint8Array, fileName: string): Promise<string> {
  const fileExt = fileName.split('.').pop()?.toLowerCase() || "";
  
  if (fileExt === "pdf") {
    try {
      // Set up the PDF.js worker
      const pdfjsWorker = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;
      
      // Load the PDF document
      const loadingTask = pdfjs.getDocument({ data: fileBytes });
      const pdfDocument = await loadingTask.promise;
      
      // Get the total number of pages
      const numPages = pdfDocument.numPages;
      log(`PDF document loaded with ${numPages} pages`, "info");
      
      // Extract text from each page
      const textContent: string[] = [];
      
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        try {
          const page = await pdfDocument.getPage(pageNum);
          const content = await page.getTextContent();
          
          // Extract text items and join them with appropriate spacing
          const pageText = content.items
            .map((item: any) => {
              // Handle different item types
              if (typeof item.str === 'string') {
                return item.str;
              }
              return '';
            })
            .join(' ');
          
          textContent.push(pageText);
        } catch (pageError) {
          log(`Error extracting text from page ${pageNum}: ${pageError.message}`, "error");
        }
      }
      
      // Join all pages with newlines
      return textContent.join('\n\n');
    } catch (error) {
      log(`Error in PDF extraction: ${error.message}. Falling back to basic extraction.`, "error");
      
      // Fall back to the original regex-based extraction method
      try {
        const decoder = new TextDecoder("utf-8");
        const rawText = decoder.decode(fileBytes);
        
        // Enhanced PDF text extraction
        // Look for common PDF text patterns
        const textBlocks = [];
        
        // Pattern 1: Look for text objects with BT...ET blocks
        const btEtBlocks = rawText.match(/BT[\s\S]+?ET/g) || [];
        for (const block of btEtBlocks) {
          // Extract text strings from the block
          const textStrings = block.match(/(\([^\)]+\)|<[^>]+>)\s*Tj/g) || [];
          for (const textString of textStrings) {
            // Clean up the text string
            let text = textString
              .replace(/(\([^\)]+\)|<[^>]+>)\s*Tj/, '$1')
              .replace(/^\(|\)$/g, '') // Remove outer parentheses
              .replace(/\\\(/g, '(')
              .replace(/\\\)/g, ')')
              .replace(/\\n/g, '\n')
              .replace(/\\r/g, '')
              .replace(/\\t/g, ' ');
            
            textBlocks.push(text);
          }
        }
        
        // Pattern 2: Look for text arrays with TJ operator
        const tjArrays = rawText.match(/\[[^\]]+\]\s*TJ/g) || [];
        for (const array of tjArrays) {
          // Extract text strings from the array
          const textStrings = array.match(/(\([^\)]+\))/g) || [];
          for (const textString of textStrings) {
            // Clean up the text string
            let text = textString
              .replace(/^\(|\)$/g, '') // Remove outer parentheses
              .replace(/\\\(/g, '(')
              .replace(/\\\)/g, ')')
              .replace(/\\n/g, '\n')
              .replace(/\\r/g, '')
              .replace(/\\t/g, ' ');
            
            textBlocks.push(text);
          }
        }
        
        // If we found text blocks, join them with spaces
        if (textBlocks.length > 0) {
          return textBlocks.join(' ');
        }
        
        // If no text blocks found, fall back to basic extraction
        return rawText;
      } catch (fallbackError) {
        log(`Error in fallback extraction: ${fallbackError.message}. Using basic decoder.`, "error");
        // Ultimate fallback - just decode the bytes
        const decoder = new TextDecoder("utf-8");
        return decoder.decode(fileBytes);
      }
    }
  } 
  // Add DOC/DOCX handling
  else if (fileExt === "doc" || fileExt === "docx") {
    try {
      // Convert Uint8Array to ArrayBuffer
      const arrayBuffer = fileBytes.buffer;
      
      // Use mammoth.js to extract text
      const result = await extract({ arrayBuffer });
      
      // Get the main text content
      let extractedText = result.value || "";
      
      // Add messages if present
      if (result.messages && result.messages.length > 0) {
        extractedText += "\n\nProcessing Messages:\n" + 
          result.messages.map(m => m.message).join("\n");
      }
      
      return extractedText;
    } catch (error) {
      log(`Error extracting DOCX content: ${error.message}`, "error");
      // Fall back to basic decoder
      const decoder = new TextDecoder("utf-8");
      return decoder.decode(fileBytes);
    }
  }
  else {
    // For all other files, use basic decoder
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(fileBytes);
  }
}