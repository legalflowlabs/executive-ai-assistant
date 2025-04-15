/**
 * Text chunking module for document processing
 */
import { log } from "./utils.ts";

/**
 * Result of text chunking operation
 */
export interface ChunkResult {
  /** Array of text chunks */
  chunks: string[];
  /** Metadata for each chunk */
  metadata: any[];
}

/**
 * Chunk text into smaller pieces with metadata
 * @param text - The text to chunk
 * @param chunkSize - The maximum size of each chunk
 * @param overlap - The overlap between chunks
 * @returns Object containing chunks and their metadata
 */
export function chunkText(text: string, chunkSize = 1000, overlap = 100): ChunkResult {
  const chunks: string[] = [];
  const metadata: any[] = [];
  
  // Check if text contains section markers (likely from LlamaIndex parsing)
  const hasSectionMarkers = text.includes('# ') || text.includes('## ') || text.includes('### ');
  
  if (hasSectionMarkers) {
    // Enhanced chunking for structured documents (from LlamaIndex)
    // Split by section headers first
    const sectionPattern = /(?=(?:^|\n)(?:#{1,3} ))/;
    const sections = text.split(sectionPattern).filter(section => section.trim());
    
    let currentChunk = "";
    let currentSectionIndex = 0;
    let sectionTitle = "";
    
    for (const section of sections) {
      // Extract section title if present
      const titleMatch = section.match(/^(#{1,3} .+)(?:\n|$)/);
      if (titleMatch) {
        sectionTitle = titleMatch[1];
      }
      
      // If adding this section would exceed the chunk size, store the current chunk and start a new one
      if (currentChunk && (currentChunk.length + section.length > chunkSize)) {
        chunks.push(currentChunk);
        metadata.push({ 
          section_index: currentSectionIndex,
          section_title: sectionTitle,
          is_structured: true
        });
        
        // Start new chunk with overlap from the previous chunk
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + "\n\n" + section;
      } else {
        // Add section to current chunk
        if (currentChunk) {
          currentChunk += "\n\n" + section;
        } else {
          currentChunk = section;
        }
      }
      
      currentSectionIndex++;
    }
    
    // Add the last chunk if it's not empty
    if (currentChunk) {
      chunks.push(currentChunk);
      metadata.push({ 
        section_index: currentSectionIndex,
        section_title: sectionTitle,
        is_structured: true
      });
    }
  } else {
    // Original paragraph-based chunking for unstructured text
    // Split text by paragraphs first to try to maintain document structure
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = "";
    let currentPage = 1;
    let paragraphCount = 0;
    
    for (const paragraph of paragraphs) {
      // Skip empty paragraphs
      if (!paragraph.trim()) continue;
      
      paragraphCount++;
      
      // Estimate page breaks based on paragraph count
      // This is a simple heuristic - about 10 paragraphs per page
      if (paragraphCount > 10) {
        currentPage++;
        paragraphCount = 1;
      }
      
      // If adding this paragraph would exceed the chunk size, store the current chunk and start a new one
      if (currentChunk && (currentChunk.length + paragraph.length > chunkSize)) {
        chunks.push(currentChunk);
        metadata.push({ 
          page: currentPage, 
          paragraph_start: Math.max(1, paragraphCount - 5),
          is_structured: false
        });
        
        // Start new chunk with overlap from the previous chunk
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + "\n\n" + paragraph;
      } else {
        // Add paragraph to current chunk
        if (currentChunk) {
          currentChunk += "\n\n" + paragraph;
        } else {
          currentChunk = paragraph;
        }
      }
    }
    
    // Add the last chunk if it's not empty
    if (currentChunk) {
      chunks.push(currentChunk);
      metadata.push({ 
        page: currentPage, 
        paragraph_start: paragraphCount,
        is_structured: false
      });
    }
    
    // If no chunks were created (e.g., very short document), use the original method
    if (chunks.length === 0) {
      let i = 0;
      while (i < text.length) {
        const chunk = text.slice(i, i + chunkSize);
        chunks.push(chunk);
        metadata.push({ 
          page: 1, 
          position: i,
          is_structured: false
        });
        i += chunkSize - overlap;
      }
    }
  }
  
  log(`Created ${chunks.length} chunks from text of length ${text.length}`, "info");
  return { chunks, metadata };
}