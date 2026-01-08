import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface DocumentInput {
  title: string;
  content: string;
  source: string; // "RSNA", "CDC", "WHO", etc.
  reportType: string; // "x-ray", "mri", "ct", "lab", "general"
  contentCategory: string; // "findings", "observations", "guidelines", "anatomy", "interpretation"
  metadata?: Record<string, unknown>;
}

interface ChunkResult {
  text: string;
  index: number;
}

// Generate embedding using Google's text-embedding-004 model
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  console.log(`Generating embedding for chunk (${text.length} chars)...`);
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_DOCUMENT"
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Embedding API error:", response.status, errorText);
    throw new Error(`Failed to generate embedding: ${response.status}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

// Chunk text into overlapping segments for better retrieval
function chunkText(text: string, chunkSize = 1000, overlap = 200): ChunkResult[] {
  const chunks: ChunkResult[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  
  let currentChunk = "";
  let chunkIndex = 0;
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      chunks.push({ text: currentChunk.trim(), index: chunkIndex++ });
      
      // Keep overlap from the end of current chunk
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(overlap / 5));
      currentChunk = overlapWords.join(" ") + " " + sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }
  
  // Add the last chunk
  if (currentChunk.trim()) {
    chunks.push({ text: currentChunk.trim(), index: chunkIndex });
  }
  
  return chunks;
}

// Process and store a single document
async function processDocument(
  supabase: any,
  doc: DocumentInput,
  geminiApiKey: string
): Promise<{ documentId: string; chunksCreated: number }> {
  console.log(`Processing document: ${doc.title}`);
  
  // Insert main document
  const { data: docData, error: docError } = await supabase
    .from('knowledge_documents')
    .insert({
      title: doc.title,
      content: doc.content,
      source: doc.source,
      report_type: doc.reportType,
      content_category: doc.contentCategory,
      metadata: doc.metadata || {}
    })
    .select('id')
    .single();

  if (docError) {
    console.error("Error inserting document:", docError);
    throw new Error(`Failed to insert document: ${docError.message}`);
  }

  const documentId = docData.id as string;
  console.log(`Document created with ID: ${documentId}`);

  // Chunk the content
  const chunks = chunkText(doc.content);
  console.log(`Created ${chunks.length} chunks`);

  // Process each chunk with embeddings
  let chunksCreated = 0;
  
  for (const chunk of chunks) {
    try {
      // Generate embedding for this chunk
      const embedding = await generateEmbedding(chunk.text, geminiApiKey);
      
      // Insert chunk with embedding
      const { error: chunkError } = await supabase
        .from('document_chunks')
        .insert({
          document_id: documentId,
          content: chunk.text,
          chunk_index: chunk.index,
          embedding: JSON.stringify(embedding),
          source: doc.source,
          report_type: doc.reportType,
          content_category: doc.contentCategory
        });

      if (chunkError) {
        console.error(`Error inserting chunk ${chunk.index}:`, chunkError);
      } else {
        chunksCreated++;
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (embeddingError) {
      console.error(`Error processing chunk ${chunk.index}:`, embeddingError);
    }
  }

  console.log(`Successfully created ${chunksCreated}/${chunks.length} chunks for document ${documentId}`);
  return { documentId, chunksCreated };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    
    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "Gemini API key not configured. Required for generating embeddings." }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const body = await req.json();
    
    // Support both single document and batch ingestion
    const documents: DocumentInput[] = Array.isArray(body.documents) ? body.documents : [body];
    
    if (documents.length === 0 || !documents[0].title) {
      return new Response(
        JSON.stringify({ 
          error: "Invalid request. Provide document(s) with: title, content, source, reportType, contentCategory" 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`=== DOCUMENT INGESTION START ===`);
    console.log(`Processing ${documents.length} document(s)`);

    const results: Array<{ title: string; documentId: string; chunksCreated: number; error?: string }> = [];

    for (const doc of documents) {
      try {
        // Validate required fields
        if (!doc.title || !doc.content || !doc.source || !doc.reportType || !doc.contentCategory) {
          results.push({
            title: doc.title || "Unknown",
            documentId: "",
            chunksCreated: 0,
            error: "Missing required fields"
          });
          continue;
        }

        const result = await processDocument(supabase, doc, GEMINI_API_KEY);
        results.push({
          title: doc.title,
          documentId: result.documentId,
          chunksCreated: result.chunksCreated
        });
      } catch (docError) {
        console.error(`Error processing document ${doc.title}:`, docError);
        results.push({
          title: doc.title,
          documentId: "",
          chunksCreated: 0,
          error: docError instanceof Error ? docError.message : "Processing failed"
        });
      }
    }

    const successCount = results.filter(r => !r.error).length;
    const totalChunks = results.reduce((sum, r) => sum + r.chunksCreated, 0);

    console.log(`=== INGESTION COMPLETE ===`);
    console.log(`Successfully processed ${successCount}/${documents.length} documents`);
    console.log(`Total chunks created: ${totalChunks}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${successCount}/${documents.length} documents with ${totalChunks} total chunks`,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Ingestion error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
