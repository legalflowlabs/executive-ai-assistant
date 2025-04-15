import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "./_shared/cors.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { log } from "./utils/utils.ts"
import { generateEmbedding } from "./utils/documentProcessor.ts"

// Environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

// Initialize Supabase client
const supabase = createClient(
  SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Main handler for retrieving relevant data
 */
serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  
  try {
    const {
      query,
      firm_id,
      similarity_threshold = 0.7,
      match_count = 5,
      filter_metadata = null
    } = await req.json()
    
    // Validate required parameters
    if (!query) {
      throw new Error("Query text is required")
    }
    
    if (!firm_id) {
      throw new Error("Firm ID is required")
    }
    
    // Generate embedding for the query text
    const queryEmbedding = await generateEmbedding(query)
    
    // Call the match_document_chunks function to find relevant data
    const { data: relevantChunks, error } = await supabase.rpc(
      'match_document_chunks',
      {
        query_embedding: queryEmbedding,
        similarity_threshold,
        match_count,
        firm_id,
        filter_metadata
      }
    )
    
    if (error) {
      throw new Error(`Error retrieving relevant data: ${error.message}`)
    }
    
    // Process the results to include document information
    const enhancedResults = await Promise.all(
      relevantChunks.map(async (chunk) => {
        // Get document information
        const { data: document, error: docError } = await supabase
          .from('documents')
          .select('file_name, document_type, description')
          .eq('id', chunk.document_id)
          .single()
        
        if (docError) {
          log(`Error fetching document info: ${docError.message}`, "warn")
          return {
            ...chunk,
            document_info: null
          }
        }
        
        return {
          ...chunk,
          document_info: document
        }
      })
    )
    
    return new Response(
      JSON.stringify({
        success: true,
        query,
        results: enhancedResults,
        result_count: enhancedResults.length
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      }
    )
  } catch (error) {
    log(`Error processing request: ${error.message}`, "error")
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400
      }
    )
  }
})