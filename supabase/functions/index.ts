import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "./_shared/cors.ts"

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const LLAMAINDEX_API_KEY = Deno.env.get("LLAMAINDEX_API_KEY")
const LLAMAINDEX_API_URL = Deno.env.get("LLAMAINDEX_API_URL") || "https://api.llamaindex.ai/v1"

const supabase = createClient(
  SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY!
)

// Import PDF.js as fallback for PDF parsing
import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/+esm"

// Function to extract text using LlamaIndex API
async function extractTextWithLlamaIndex(fileBytes: Uint8Array, fileName: string): Promise<string> {
  if (!LLAMAINDEX_API_KEY) {
    console.warn("LLAMAINDEX_API_KEY not set, falling back to local extraction")
    return extractTextWithFallback(fileBytes, fileName)
  }
  
  try {
    // Convert file bytes to base64
    const base64File = btoa(String.fromCharCode(...new Uint8Array(fileBytes)))
    
    // Get file extension to determine document type
    const fileExt = fileName.split('.').pop()?.toLowerCase() || ""
    
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
    })
    
    if (!response.ok) {
      const errorData = await response.json()
      console.error(`LlamaIndex API error: ${JSON.stringify(errorData)}`)
      return extractTextWithFallback(fileBytes, fileName)
    }
    
    const result = await response.json()
    
    // Extract text from the parsed document
    let extractedText = ""
    
    // Process sections if available
    if (result.sections && result.sections.length > 0) {
      extractedText = result.sections.map((section: any) => {
        let sectionText = section.text || ""
        
        // Add section title if available
        if (section.title) {
          sectionText = `${section.title}\n\n${sectionText}`
        }
        
        return sectionText
      }).join("\n\n")
    } else if (result.text) {
      // Use plain text if sections not available
      extractedText = result.text
    }
    
    // Process tables if available and append to text
    if (result.tables && result.tables.length > 0) {
      const tablesText = result.tables.map((table: any) => {
        return `Table: ${table.title || 'Untitled'}\n${table.text || JSON.stringify(table.data)}`
      }).join("\n\n")
      
      extractedText += "\n\n" + tablesText
    }
    
    // If we got text, return it
    if (extractedText.trim()) {
      console.log(`Successfully extracted text using LlamaIndex API: ${extractedText.length} characters`)
      return extractedText
    }
    
    // If no text was extracted, fall back to local extraction
    console.warn("LlamaIndex API returned empty text, falling back to local extraction")
    return extractTextWithFallback(fileBytes, fileName)
  } catch (error) {
    console.error(`Error using LlamaIndex API: ${error.message}. Falling back to local extraction.`)
    return extractTextWithFallback(fileBytes, fileName)
  }
}

// Helper function to get MIME type from file extension
function getMimeType(fileExt: string): string {
  const mimeTypes: Record<string, string> = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
    "md": "text/markdown",
    "html": "text/html",
    "htm": "text/html",
    "rtf": "application/rtf",
    "odt": "application/vnd.oasis.opendocument.text"
  }
  
  return mimeTypes[fileExt] || "application/octet-stream"
}

// Fallback text extraction function using PDF.js and basic methods
async function extractTextWithFallback(fileBytes: Uint8Array, fileName: string): Promise<string> {
  // Get file extension to determine parsing method
  const fileExt = fileName.split('.').pop()?.toLowerCase() || ""
  
  if (fileExt === "pdf") {
    try {
      // Set up the PDF.js worker
      const pdfjsWorker = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js")
      pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker
      
      // Load the PDF document
      const loadingTask = pdfjs.getDocument({ data: fileBytes })
      const pdfDocument = await loadingTask.promise
      
      // Get the total number of pages
      const numPages = pdfDocument.numPages
      console.log(`PDF document loaded with ${numPages} pages`)
      
      // Extract text from each page
      const textContent: string[] = []
      
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        try {
          const page = await pdfDocument.getPage(pageNum)
          const content = await page.getTextContent()
          
          // Extract text items and join them with appropriate spacing
          const pageText = content.items
            .map((item: any) => {
              // Handle different item types
              if (typeof item.str === 'string') {
                return item.str
              }
              return ''
            })
            .join(' ')
          
          textContent.push(pageText)
        } catch (pageError) {
          console.error(`Error extracting text from page ${pageNum}: ${pageError.message}`)
        }
      }
      
      // Join all pages with newlines
      return textContent.join('\n\n')
    } catch (error) {
      console.error(`Error in PDF extraction: ${error.message}. Falling back to basic extraction.`)
      
      // Fall back to the original regex-based extraction method
      try {
        const decoder = new TextDecoder("utf-8")
        const rawText = decoder.decode(fileBytes)
        
        // Enhanced PDF text extraction
        // Look for common PDF text patterns
        const textBlocks = []
        
        // Pattern 1: Look for text objects with BT...ET blocks
        const btEtBlocks = rawText.match(/BT[\s\S]+?ET/g) || []
        for (const block of btEtBlocks) {
          // Extract text strings from the block
          const textStrings = block.match(/(\([^\)]+\)|<[^>]+>)\s*Tj/g) || []
          for (const textString of textStrings) {
            // Clean up the text string
            let text = textString
              .replace(/(\([^\)]+\)|<[^>]+>)\s*Tj/, '$1')
              .replace(/^\(|\)$/g, '') // Remove outer parentheses
              .replace(/\\\(/g, '(')
              .replace(/\\\)/g, ')')
              .replace(/\\n/g, '\n')
              .replace(/\\r/g, '')
              .replace(/\\t/g, ' ')
            
            textBlocks.push(text)
          }
        }
        
        // Pattern 2: Look for text arrays with TJ operator
        const tjArrays = rawText.match(/\[[^\]]+\]\s*TJ/g) || []
        for (const array of tjArrays) {
          // Extract text strings from the array
          const textStrings = array.match(/(\([^\)]+\))/g) || []
          for (const textString of textStrings) {
            // Clean up the text string
            let text = textString
              .replace(/^\(|\)$/g, '') // Remove outer parentheses
              .replace(/\\\(/g, '(')
              .replace(/\\\)/g, ')')
              .replace(/\\n/g, '\n')
              .replace(/\\r/g, '')
              .replace(/\\t/g, ' ')
            
            textBlocks.push(text)
          }
        }
        
        // If we found text blocks, join them with spaces
        if (textBlocks.length > 0) {
          return textBlocks.join(' ')
        }
        
        // If no text blocks found, fall back to basic extraction
        return rawText
      } catch (fallbackError) {
        console.error(`Error in fallback extraction: ${fallbackError.message}. Using basic decoder.`)
        // Ultimate fallback - just decode the bytes
        const decoder = new TextDecoder("utf-8")
        return decoder.decode(fileBytes)
      }
    }
  } else {
    // For non-PDF files, use the original text extraction method
    const decoder = new TextDecoder("utf-8")
    return decoder.decode(fileBytes)
  }
}

// Main text extraction function that uses LlamaIndex with fallback
async function extractText(fileBytes: Uint8Array, fileName: string): Promise<string> {
  return extractTextWithLlamaIndex(fileBytes, fileName)
}

function chunkText(text: string, chunkSize = 1000, overlap = 100): { chunks: string[], metadata: any[] } {
  const chunks: string[] = []
  const metadata: any[] = []
  
  // Check if text contains section markers (likely from LlamaIndex parsing)
  const hasSectionMarkers = text.includes('# ') || text.includes('## ') || text.includes('### ')
  
  if (hasSectionMarkers) {
    // Enhanced chunking for structured documents (from LlamaIndex)
    // Split by section headers first
    const sectionPattern = /(?=(?:^|\n)(?:#{1,3} ))/
    const sections = text.split(sectionPattern).filter(section => section.trim())
    
    let currentChunk = ""
    let currentSectionIndex = 0
    let sectionTitle = ""
    
    for (const section of sections) {
      // Extract section title if present
      const titleMatch = section.match(/^(#{1,3} .+)(?:\n|$)/)
      if (titleMatch) {
        sectionTitle = titleMatch[1]
      }
      
      // If adding this section would exceed the chunk size, store the current chunk and start a new one
      if (currentChunk && (currentChunk.length + section.length > chunkSize)) {
        chunks.push(currentChunk)
        metadata.push({ 
          section_index: currentSectionIndex,
          section_title: sectionTitle,
          is_structured: true
        })
        
        // Start new chunk with overlap from the previous chunk
        const overlapText = currentChunk.slice(-overlap)
        currentChunk = overlapText + "\n\n" + section
      } else {
        // Add section to current chunk
        if (currentChunk) {
          currentChunk += "\n\n" + section
        } else {
          currentChunk = section
        }
      }
      
      currentSectionIndex++
    }
    
    // Add the last chunk if it's not empty
    if (currentChunk) {
      chunks.push(currentChunk)
      metadata.push({ 
        section_index: currentSectionIndex,
        section_title: sectionTitle,
        is_structured: true
      })
    }
  } else {
    // Original paragraph-based chunking for unstructured text
    // Split text by paragraphs first to try to maintain document structure
    const paragraphs = text.split(/\n\s*\n/)
    let currentChunk = ""
    let currentPage = 1
    let paragraphCount = 0
    
    for (const paragraph of paragraphs) {
      // Skip empty paragraphs
      if (!paragraph.trim()) continue
      
      paragraphCount++
      
      // Estimate page breaks based on paragraph count
      // This is a simple heuristic - about 10 paragraphs per page
      if (paragraphCount > 10) {
        currentPage++
        paragraphCount = 1
      }
      
      // If adding this paragraph would exceed the chunk size, store the current chunk and start a new one
      if (currentChunk && (currentChunk.length + paragraph.length > chunkSize)) {
        chunks.push(currentChunk)
        metadata.push({ 
          page: currentPage, 
          paragraph_start: Math.max(1, paragraphCount - 5),
          is_structured: false
        })
        
        // Start new chunk with overlap from the previous chunk
        const overlapText = currentChunk.slice(-overlap)
        currentChunk = overlapText + "\n\n" + paragraph
      } else {
        // Add paragraph to current chunk
        if (currentChunk) {
          currentChunk += "\n\n" + paragraph
        } else {
          currentChunk = paragraph
        }
      }
    }
    
    // Add the last chunk if it's not empty
    if (currentChunk) {
      chunks.push(currentChunk)
      metadata.push({ 
        page: currentPage, 
        paragraph_start: paragraphCount,
        is_structured: false
      })
    }
    
    // If no chunks were created (e.g., very short document), use the original method
    if (chunks.length === 0) {
      let i = 0
      while (i < text.length) {
        const chunk = text.slice(i, i + chunkSize)
        chunks.push(chunk)
        metadata.push({ 
          page: 1, 
          position: i,
          is_structured: false
        })
        i += chunkSize - overlap
      }
    }
  }
  
  return { chunks, metadata }
}

// Function to generate embeddings using OpenAI
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input: text,
      model: "text-embedding-3-small"
    })
  })
  
  const result = await response.json()
  return result.data[0].embedding
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  
  try {
    const { record } = await req.json()
    
    // Get file metadata from the storage.objects table
    const { path, id } = record
    
    // Extract firm_id, document_type, etc. from the path
    // Assuming path format: files/{firm_id}/{filename}
    const pathParts = path.split('/')
    if (pathParts.length < 3) {
      throw new Error("Invalid file path format")
    }
    
    const firmId = pathParts[1]
    const fileName = pathParts[2]
    
    // Download the file from storage
    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from('documents')
      .download(path)
    
    if (downloadError) {
      throw new Error(`Error downloading file: ${downloadError.message}`)
    }
    
    // Extract document metadata from the path or filename
    // This is a simplified approach - you might want to store metadata separately
    const documentType = fileName.split('.').pop()?.toLowerCase() || "unknown"
    const description = `Automatically processed document: ${fileName}`
    
    // Create document record
    const { data: document, error: documentError } = await supabase
      .from('documents')
      .insert({
        firm_id: firmId,
        file_name: fileName,
        storage_path: path,
        document_type: documentType,
        description: description,
        client_safe: false // Default to false for auto-processed documents
      })
      .select()
      .single()
    
    if (documentError) {
      throw new Error(`Error creating document record: ${documentError.message}`)
    }
    
    // Extract text from the document
    const text = await extractText(new Uint8Array(await fileData.arrayBuffer()), fileName)
    
    // Chunk the text with improved structure awareness
    const { chunks, metadata } = chunkText(text)
    
    console.log(`Document processed into ${chunks.length} structured chunks`)
    
    // Process each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      
      // Generate embedding
      const embedding = await generateEmbedding(chunk)
      
      // Enhanced metadata with document type and structure information
      const enhancedMetadata = {
        ...metadata[i],
        document_type: documentType,
        file_name: fileName,
        chunk_index: i,
        total_chunks: chunks.length,
        char_count: chunk.length,
        word_count: chunk.split(/\s+/).length
      }
      
      // Insert chunk with embedding and enhanced metadata
      const { error: chunkError } = await supabase
        .from('document_chunks')
        .insert({
          document_id: document.id,
          firm_id: firmId,
          chunk_text: chunk,
          chunk_index: i,
          embedding: embedding,
          metadata: enhancedMetadata
        })
      
      if (chunkError) {
        console.error(`Error inserting chunk ${i}: ${chunkError.message}`)
      }
    }
    
    return new Response(
      JSON.stringify({ success: true, document_id: document.id, chunks: chunks.length }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200 
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400 
      }
    )
  }
})