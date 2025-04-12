-- Create stored procedure for similarity search
CREATE OR REPLACE FUNCTION match_document_chunks(
    query_embedding VECTOR(1536),
    similarity_threshold FLOAT,
    match_count INT,
    firm_id UUID,
    filter_metadata JSONB DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    document_id UUID,
    firm_id UUID,
    chunk_text TEXT,
    chunk_index INTEGER,
    similarity FLOAT,
    metadata JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF filter_metadata IS NULL THEN
        RETURN QUERY
        SELECT
            dc.id,
            dc.document_id,
            dc.firm_id,
            dc.chunk_text,
            dc.chunk_index,
            1 - (dc.embedding <=> query_embedding) AS similarity,
            dc.metadata
        FROM
            document_chunks dc
        JOIN
            documents d ON d.id = dc.document_id
        WHERE
            dc.firm_id = match_document_chunks.firm_id
            AND 1 - (dc.embedding <=> query_embedding) > similarity_threshold
        ORDER BY
            dc.embedding <=> query_embedding
        LIMIT match_count;
    ELSE
        RETURN QUERY
        SELECT
            dc.id,
            dc.document_id,
            dc.firm_id,
            dc.chunk_text,
            dc.chunk_index,
            1 - (dc.embedding <=> query_embedding) AS similarity,
            dc.metadata
        FROM
            document_chunks dc
        JOIN
            documents d ON d.id = dc.document_id
        WHERE
            dc.firm_id = match_document_chunks.firm_id
            AND 1 - (dc.embedding <=> query_embedding) > similarity_threshold
            AND d.document_type = COALESCE(filter_metadata->>'document_type', d.document_type)
            AND (filter_metadata->>'client_safe' IS NULL OR d.client_safe = (filter_metadata->>'client_safe')::boolean)
        ORDER BY
            dc.embedding <=> query_embedding
        LIMIT match_count;
    END IF;
END;
$$;