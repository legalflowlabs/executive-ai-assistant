-- Create a function to notify about new storage objects
CREATE OR REPLACE FUNCTION handle_storage_update()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT;
BEGIN
  -- Get the Supabase URL from environment variable or use default
  supabase_url := coalesce(current_setting('app.settings.supabase_url', true), 'http://localhost:54321');
  
  IF TG_OP = 'INSERT' AND NEW.bucket_id = 'documents' THEN
    -- Call the Edge Function to process the document
    PERFORM
      net.http_post(
        url := supabase_url || '/functions/v1/process-document',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}',
        body := json_build_object('record', row_to_json(NEW))::text
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a trigger on the storage.objects table
DROP TRIGGER IF EXISTS on_storage_update ON storage.objects;
CREATE TRIGGER on_storage_update
  AFTER INSERT ON storage.objects
  FOR EACH ROW
  EXECUTE PROCEDURE handle_storage_update();