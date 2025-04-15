/**
 * Document processing module for handling database operations
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { log } from "./utils.ts";
import { ChunkResult } from "./textChunker.ts";

// Environment variables
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Initialize Supabase client
const supabase = createClient(
  SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Document record from database
 */
export interface Document {
  id: string;
  firm_id: string;
  file_name: string;
  storage_path: string;
  document_type: string;
  description: string;
  client_safe: boolean;
  [key: string]: any; // For any additional fields
}

/**
 * Download a file from Supabase storage
 * @param path - The storage path of the file
 * @returns File content as Uint8Array
 */
export async function downloadFile(path: string): Promise<Uint8Array> {
  const { data: fileData, error: downloadError } = await supabase
    .storage
    .from('documents')
    .download(path);
  
  if (downloadError) {
    throw new Error(`Error downloading file: ${downloadError.message}`);
  }
  
  return new Uint8Array(await fileData.arrayBuffer());
}

/**
 * Create a document record in the database
 * @param firmId - The firm ID
 * @param fileName - The file name
 * @param storagePath - The storage path
 * @param documentType - The document type
 * @returns The created document record
 */
export async function createDocumentRecord(
  firmId: string,
  fileName: string,
  storagePath: string,
  documentType: string
): Promise<Document> {
  const description = `Automatically processed document: ${fileName}`;
  
  const { data: document, error: documentError } = await supabase
    .from('documents')
    .insert({
      firm_id: firmId,
      file_name: fileName,
      storage_path: storagePath,
      document_type: documentType,
      description: description,
      client_safe: false // Default to false for auto-processed documents
    })
    .select()
    .single();
  
  if (documentError) {
    throw new Error(`Error creating document record: ${documentError.message}`);
  }
  
  return document;
}

/**
 * Generate embedding for text using OpenAI API
 * @param text - The text to generate embedding for
 * @returns The embedding as an array of numbers
 */
async function generateEmbedding(text: string): Promise<number[]> {
  try {
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
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API error: ${JSON.stringify(errorData)}`);
    }
    
    const result = await response.json();
    return result.data[0].embedding;
  } catch (error) {
    log(`Error generating embedding: ${error.message}`, "error");
    throw error;
  }
}

/**
 * Process document chunks and store them in the database
 * @param document - The document record
 * @param firmId - The firm ID
 * @param documentType - The document type
 * @param fileName - The file name
 * @param chunkResult - The result of text chunking
 * @returns The number of successfully processed chunks
 */
export async function processDocumentChunks(
  document: Document,
  firmId: string,
  documentType: string,
  fileName: string,
  chunkResult: ChunkResult
): Promise<number> {
  const { chunks, metadata } = chunkResult;
  let successCount = 0;
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    try {
      // Generate embedding
      const embedding = await generateEmbedding(chunk);
      
      // Enhanced metadata with document type and structure information
      const enhancedMetadata = {
        ...metadata[i],
        document_type: documentType,
        file_name: fileName,
        chunk_index: i,
        total_chunks: chunks.length,
        char_count: chunk.length,
        word_count: chunk.split(/\s+/).length
      };
      
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
        });
      
      if (chunkError) {
        log(`Error inserting chunk ${i}: ${chunkError.message}`, "error");
      } else {
        successCount++;
      }
    } catch (error) {
      log(`Error processing chunk ${i}: ${error.message}`, "error");
    }
  }
  
  return successCount;
}