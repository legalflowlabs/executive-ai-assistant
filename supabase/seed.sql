select vault.create_secret(
  'http://api.supabase.internal:8000', -- Change this dependent on your deployment
  'supabase_url'
);