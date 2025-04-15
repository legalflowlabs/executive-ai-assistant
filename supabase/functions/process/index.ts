import { createClient } from '@supabase/supabase-js';
import { Database } from '../_lib/database.ts';
import { parseFile, isSupportedFileType } from '../_lib/file-parser.ts';
import { getFileExtension } from '../_lib/utils.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

Deno.serve(async (req) => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({
        error: 'Missing environment variables.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const authorization = req.headers.get('Authorization');

  if (!authorization) {
    return new Response(
      JSON.stringify({ error: `No authorization header passed` }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        authorization,
      },
    },
    auth: {
      persistSession: false,
    },
  });

  const { document_id } = await req.json();

  const { data: document } = await supabase
    .from('documents_with_storage_path')
    .select()
    .eq('id', document_id)
    .single();

  if (!document?.storage_object_path) {
    return new Response(
      JSON.stringify({ error: 'Failed to find uploaded document' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const { data: file } = await supabase.storage
    .from('files')
    .download(document.storage_object_path);

  if (!file) {
    return new Response(
      JSON.stringify({ error: 'Failed to download storage object' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Get file extension from storage path
  const fileExt = getFileExtension(document.storage_object_path);
  
  // Convert file to array buffer for binary processing
  const fileBuffer = await file.arrayBuffer();
  const fileContent = new Uint8Array(fileBuffer);
  
  let processedMd;
  
  // Check if file type is supported and return error if not
  if (!isSupportedFileType(fileExt)) {
    return new Response(
      JSON.stringify({ error: `Unsupported file type: ${fileExt}` }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
  
  // Parse the file using the appropriate parser
  const parseResult = await parseFile(fileContent, document.storage_object_path);
  processedMd = parseResult.processed;

  const { error } = await supabase.from('document_sections').insert(
    processedMd.sections.map(({ content }) => ({
      document_id,
      content,
    }))
  );

  if (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ error: 'Failed to save document sections' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  console.log(
    `Saved ${processedMd.sections.length} sections for file '${document.name}'`
  );

  return new Response(null, {
    status: 204,
    headers: { 'Content-Type': 'application/json' },
  });
});
