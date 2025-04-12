-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create law_firms table
CREATE TABLE IF NOT EXISTS law_firms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add RLS policies for law_firms
ALTER TABLE law_firms ENABLE ROW LEVEL SECURITY;

-- Create policy for selecting law firms
CREATE POLICY select_law_firms ON law_firms
    FOR SELECT USING (true);

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firm_id UUID NOT NULL REFERENCES law_firms(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    description TEXT,
    document_type TEXT NOT NULL,
    client_safe BOOLEAN DEFAULT FALSE,
    tags TEXT[] DEFAULT '{}',
    author TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on firm_id
CREATE INDEX IF NOT EXISTS idx_documents_firm_id ON documents(firm_id);

-- Add RLS policies for documents
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Create policy for selecting documents
CREATE POLICY select_documents ON documents
    FOR SELECT USING (true);

-- Create document_chunks table with vector support
CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    firm_id UUID NOT NULL REFERENCES law_firms(id) ON DELETE CASCADE,
    chunk_text TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    embedding VECTOR(1536),
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_firm_id ON document_chunks(firm_id);

-- Create vector index
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Add RLS policies for document_chunks
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

-- Create policy for selecting document_chunks
CREATE POLICY select_document_chunks ON document_chunks
    FOR SELECT USING (true);