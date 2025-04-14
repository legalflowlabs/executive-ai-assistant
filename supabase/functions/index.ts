import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "./_shared/cors.ts"

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

const supabase = createClient(
  SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY!
)

async function extractText(fileBytes: Uint8Array, fileName: string): Promise<string> {
  // Get file extension to determine parsing method
  const fileExt = fileName.split('.').pop()?.toLowerCase() || ""
  
  if (fileExt === "pdf") {
    try {
      // For PDF files, use a more advanced extraction approach
      // First, attempt to extract text with PDF structure awareness
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
    } catch (error) {
      console.error(`Error in PDF extraction: ${error.message}. Falling back to basic extraction.`)
      // Fall back to basic extraction if PDF extraction fails
      const decoder = new TextDecoder("utf-8")
      return decoder.decode(fileBytes)
    }
  } else {
    // For non-PDF files, use the original text extraction method
    const decoder = new TextDecoder("utf-8")
    return decoder.decode(fileBytes)
  }
}

function chunkText(text: string, chunkSize = 1000, overlap = 100): string[] {
  const chunks: string[] = []
  let i = 0
  
  while (i < text.length) {
    const chunk = text.slice(i, i + chunkSize)
    chunks.push(chunk)
    i += chunkSize - overlap
  }
  
  return chunks
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
    
    // Chunk the text
    const chunks = chunkText(text)
    
    // Process each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      
      // Generate embedding
      const embedding = await generateEmbedding(chunk)
      
      // Insert chunk with embedding
      const { error: chunkError } = await supabase
        .from('document_chunks')
        .insert({
          document_id: document.id,
          firm_id: firmId,
          chunk_text: chunk,
          chunk_index: i,
          embedding: embedding,
          metadata: { page: Math.floor(i / 5) + 1 } // Simple metadata example
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