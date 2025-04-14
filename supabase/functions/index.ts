import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "./_shared/cors.ts"
import { getFileExtension, log } from "./lib/utils.ts"
import { extractText } from "./lib/textExtractor.ts"
import { chunkText } from "./lib/textChunker.ts"
import { downloadFile, createDocumentRecord, processDocumentChunks } from "./lib/documentProcessor.ts"

/**
 * Main handler for document processing
 */
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
    const fileBytes = await downloadFile(path)
    
    // Extract document metadata from the path or filename
    const documentType = getFileExtension(fileName) || "unknown"
    
    // Create document record
    const document = await createDocumentRecord(firmId, fileName, path, documentType)
    
    // Extract text from the document
    const text = await extractText(fileBytes, fileName)
    
    // Chunk the text with improved structure awareness
    const chunkResult = chunkText(text)
    
    log(`Document processed into ${chunkResult.chunks.length} structured chunks`, "info")
    
    // Process each chunk
    const successCount = await processDocumentChunks(
      document,
      firmId,
      documentType,
      fileName,
      chunkResult
    )
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        document_id: document.id, 
        chunks: chunkResult.chunks.length,
        processed_chunks: successCount
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200 
      }
    )
  } catch (error) {
    log(`Error processing document: ${error.message}`, "error")
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400 
      }
    )
  }
})