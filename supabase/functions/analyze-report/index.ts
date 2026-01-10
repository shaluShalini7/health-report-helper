import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RetrievedChunk {
  id: string;
  content: string;
  document_id: string;
  content_category: string;
  report_type: string;
  source: string;
  similarity: number;
  text_rank: number;
  combined_score: number;
}

interface ChunkWithTitle extends RetrievedChunk {
  document_title: string;
}

interface SafeContext {
  content: string;
  source: string;
  document_title: string;
  category: string;
}

interface Reference {
  source: string;
  title: string;
}

// Generate embedding using Gemini API
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  console.log("Generating embedding for query text...");
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY"
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

// Extract keywords from text for text-based search
function extractKeywords(text: string): string {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'been', 'be', 'have', 'has',
    'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
    'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to',
    'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
    'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again',
    'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
    'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
    'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and',
    'but', 'if', 'or', 'because', 'until', 'while', 'although', 'though',
    'this', 'that', 'these', 'those', 'which', 'who', 'whom', 'what', 'whose'
  ]);

  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));

  return [...new Set(words)].slice(0, 20).join(' | ');
}

// Perform hybrid search and enrich with document titles
async function hybridSearchWithTitles(
  supabase: any,
  queryEmbedding: number[],
  queryText: string,
  reportType?: string,
  contentCategory?: string
): Promise<ChunkWithTitle[]> {
  console.log("Performing hybrid search with document title derivation...");
  
  const keywords = extractKeywords(queryText);
  console.log("Extracted keywords:", keywords);

  const { data, error } = await supabase.rpc('hybrid_search', {
    query_embedding: JSON.stringify(queryEmbedding),
    query_text: keywords,
    filter_report_type: reportType || null,
    filter_category: contentCategory || null,
    match_count: 10,
    vector_weight: 0.7,
    text_weight: 0.3
  });

  if (error) {
    console.error("Hybrid search error:", error);
    return [];
  }

  const chunks = (data as RetrievedChunk[] | null) || [];
  console.log(`Retrieved ${chunks.length} chunks from knowledge base`);

  if (chunks.length === 0) {
    return [];
  }

  // Derive document titles by joining with knowledge_documents
  const documentIds = [...new Set(chunks.map(c => c.document_id))];
  
  const { data: documents, error: docError } = await supabase
    .from('knowledge_documents')
    .select('id, title')
    .in('id', documentIds);

  if (docError) {
    console.error("Error fetching document titles:", docError);
    // Return chunks without titles if lookup fails
    return chunks.map(c => ({ ...c, document_title: "Unknown Document" }));
  }

  const titleMap = new Map<string, string>();
  for (const doc of documents || []) {
    titleMap.set(doc.id, doc.title);
  }

  // Enrich chunks with document titles
  const enrichedChunks: ChunkWithTitle[] = chunks.map(chunk => ({
    ...chunk,
    document_title: titleMap.get(chunk.document_id) || "Unknown Document"
  }));

  console.log(`Enriched ${enrichedChunks.length} chunks with document titles`);
  return enrichedChunks;
}

// Apply safety filtering based on user mode - preserves document_title
function applySafetyFilter(chunks: ChunkWithTitle[], mode: string): SafeContext[] {
  console.log(`Applying safety filter for ${mode} mode...`);
  
  // Filter out diagnosis and treatment content categories
  const unsafeCategories = ['diagnosis', 'treatment', 'prescription', 'medication'];
  
  const filteredChunks = chunks.filter(chunk => {
    const category = chunk.content_category.toLowerCase();
    return !unsafeCategories.some(unsafe => category.includes(unsafe));
  });

  // For patient mode, apply additional filtering
  if (mode === 'patient') {
    return filteredChunks
      .filter(chunk => {
        // Exclude overly technical content for patients
        const category = chunk.content_category.toLowerCase();
        return !category.includes('clinical_protocol') && !category.includes('research');
      })
      .map(chunk => ({
        content: chunk.content,
        source: chunk.source,
        document_title: chunk.document_title,
        category: chunk.content_category
      }));
  }

  // For clinician mode, allow more technical content
  return filteredChunks.map(chunk => ({
    content: chunk.content,
    source: chunk.source,
    document_title: chunk.document_title,
    category: chunk.content_category
  }));
}

// Build context string with citation format: [SOURCE – Document Title]
function buildContext(safeContexts: SafeContext[]): string {
  if (safeContexts.length === 0) {
    return "";
  }

  const contextParts = safeContexts.map(ctx => 
    `[${ctx.source} – ${ctx.document_title}]\n${ctx.content}`
  );

  return `CONTEXT:
---
${contextParts.join('\n\n')}
---`;
}

// Extract unique references from safe contexts
function extractReferences(safeContexts: SafeContext[]): Reference[] {
  const seen = new Set<string>();
  const references: Reference[] = [];

  for (const ctx of safeContexts) {
    const key = `${ctx.source}::${ctx.document_title}`;
    if (!seen.has(key)) {
      seen.add(key);
      references.push({
        source: ctx.source,
        title: ctx.document_title
      });
    }
  }

  return references;
}

// Detect report type from image analysis
async function detectReportType(imageBase64: string, fileType: string, apiKey: string): Promise<{ type: string; extractedText: string }> {
  console.log("Detecting report type and extracting text from image...");
  
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a medical document classifier and text extractor. Analyze the image and:
1. Identify the type of medical document (X-ray, MRI, CT, Lab Report, ECG, Ultrasound, Pathology, or Other)
2. Extract all visible text and medical observations

Respond in JSON format:
{
  "reportType": "x-ray" | "mri" | "ct" | "lab" | "ecg" | "ultrasound" | "pathology" | "other",
  "extractedText": "All text and observations visible in the image",
  "anatomicalRegions": ["list of body regions visible"],
  "keyFindings": ["list of notable visual findings"]
}`
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this medical image and extract relevant information." },
              {
                type: "image_url",
                image_url: { url: `data:${fileType};base64,${imageBase64}` }
              }
            ]
          }
        ],
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorInfo = { type: "error", message: "Unknown error", details: "" };
      try {
        errorInfo = JSON.parse(errorBody);
      } catch { /* ignore parse errors */ }
      
      console.error("Report type detection failed:", errorInfo);
      
      // Return fallback with general imaging context for RAG search
      return { 
        type: "ct", // Default to CT as fallback to match knowledge base
        extractedText: "medical imaging scan abdominal pelvic chest radiograph computed tomography"
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const parsed = JSON.parse(jsonMatch[1].trim());
      
      const fullText = [
        parsed.extractedText || "",
        ...(parsed.keyFindings || []),
        ...(parsed.anatomicalRegions || [])
      ].join(" ");
      
      return {
        type: parsed.reportType || "ct",
        extractedText: fullText || "medical imaging scan"
      };
    } catch {
      return { type: "ct", extractedText: content || "medical imaging scan" };
    }
  } catch (error) {
    console.error("Report type detection error:", error);
    // Fallback to ensure RAG can proceed
    return { 
      type: "ct", 
      extractedText: "medical imaging scan abdominal pelvic chest" 
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64, fileType, mode } = await req.json();
    
    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "No image data provided" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "API key not configured" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client for RAG
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: Detect report type and extract text from image
    console.log("=== CITATION-AWARE RAG WORKFLOW START ===");
    const { type: reportType, extractedText } = await detectReportType(imageBase64, fileType, LOVABLE_API_KEY);
    console.log(`Detected report type: ${reportType}`);
    console.log(`Extracted text length: ${extractedText.length} characters`);

    // Step 2: RAG Retrieval - ALWAYS attempt before generation
    let safeContexts: SafeContext[] = [];
    let references: Reference[] = [];
    
    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY not configured - RAG cannot proceed");
      return new Response(
        JSON.stringify({
          summary: "Unable to process request. Knowledge base access is not configured.",
          references: []
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (extractedText.length < 20) {
      console.log("Insufficient text extracted from image for RAG retrieval");
      return new Response(
        JSON.stringify({
          summary: "No relevant RSNA/CDC guideline found in the knowledge base.",
          references: [],
          reportTypeDetected: reportType,
          disclaimer: "This is not a medical diagnosis. Please consult a qualified healthcare professional for accurate interpretation."
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    try {
      // Generate embedding for retrieval query
      const queryEmbedding = await generateEmbedding(extractedText, GEMINI_API_KEY);
      
      // Perform hybrid search with document title derivation
      let chunksWithTitles = await hybridSearchWithTitles(
        supabase,
        queryEmbedding,
        extractedText,
        reportType,
        undefined
      );

      // FALLBACK: If no results with report type filter, try without filter
      if (chunksWithTitles.length === 0) {
        console.log("No results with report type filter, trying without filter...");
        chunksWithTitles = await hybridSearchWithTitles(
          supabase,
          queryEmbedding,
          extractedText,
          undefined, // No filter
          undefined
        );
      }

      // FALLBACK: If still no results, return fallback response
      if (chunksWithTitles.length === 0) {
        console.log("No relevant documents found - returning fallback response");
        return new Response(
          JSON.stringify({
            summary: "No relevant RSNA/CDC guideline found in the knowledge base.",
            references: [],
            reportTypeDetected: reportType,
            disclaimer: "This is not a medical diagnosis. Please consult a qualified healthcare professional for accurate interpretation."
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Apply safety filtering (preserves document_title)
      safeContexts = applySafetyFilter(chunksWithTitles, mode);
      
      // Extract deduplicated references
      references = extractReferences(safeContexts);
      
      console.log(`RAG context built with ${safeContexts.length} safe references`);
      console.log(`Unique references: ${references.length}`);

    } catch (embeddingError) {
      console.error("Embedding/retrieval error:", embeddingError);
      return new Response(
        JSON.stringify({
          summary: "No relevant RSNA/CDC guideline found in the knowledge base.",
          references: [],
          error: "Knowledge base retrieval failed",
          reportTypeDetected: reportType,
          disclaimer: "This is not a medical diagnosis. Please consult a qualified healthcare professional for accurate interpretation."
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If safety filtering removed all chunks, return fallback
    if (safeContexts.length === 0) {
      console.log("All chunks filtered by safety filter - returning fallback");
      return new Response(
        JSON.stringify({
          summary: "No relevant RSNA/CDC guideline found in the knowledge base.",
          references: [],
          reportTypeDetected: reportType,
          disclaimer: "This is not a medical diagnosis. Please consult a qualified healthcare professional for accurate interpretation."
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 3: Build context with citation format
    const retrievedContext = buildContext(safeContexts);

    // Step 4: Build citation-aware system prompt
    const citationInstructions = `
CITATION REQUIREMENTS:
- Generate your summary using ONLY the information provided in the CONTEXT above.
- Do NOT use any external knowledge or make assumptions beyond the context.
- Include inline citations using this exact format: [SOURCE – Document Title]
- Example: "The chest radiograph shows normal findings [RSNA – Chest X-Ray Guidelines]."
- Every factual statement must be traceable to the provided context.
- Do NOT hallucinate or introduce facts not present in the context.`;

    const baseSystemPrompt = mode === "clinician" 
      ? `You are a radiology education assistant for healthcare professionals. Provide CONCISE, TECHNICAL explanations using ONLY the provided RSNA/CDC guideline context.

${retrievedContext}

${citationInstructions}

YOUR ROLE:
- Present guideline-based imaging interpretation concepts in concise bullet points
- Use standard radiology and medical terminology
- Reference RSNA/CDC protocols for this imaging modality
- Emphasize correlation with clinical findings and follow-up recommendations per guidelines

LANGUAGE STYLE:
- Concise, technical, structured
- Use bullet points for key guideline concepts
- Medical terminology appropriate for clinicians
- Phrases like: "per RSNA guidelines", "correlation with clinical presentation recommended", "follow-up imaging may be considered per protocol"

STRICTLY PROHIBITED:
- Diagnostic conclusions or confirmations
- Urgency/severity labels ("critical", "emergent", "high-risk")
- Treatment recommendations
- Statements not grounded in provided context

OUTPUT FORMAT (structured, technical, bullet-point style):
Respond in JSON format:
{
  "summary": "Concise technical overview of imaging modality and guideline-based interpretation approach. Use 2-3 structured sentences with inline citations [SOURCE – Document Title].",
  "items": [
    {
      "name": "Anatomical region or parameter",
      "value": "Technical observation per guidelines",
      "unit": "Unit if applicable",
      "referenceRange": "Guideline reference range if applicable",
      "explanation": "Brief technical note with citation [SOURCE – Document Title]",
      "status": "normal"
    }
  ],
  "guidelinePoints": [
    "• Key RSNA/CDC guideline point with citation [SOURCE – Document Title]",
    "• Protocol recommendation with citation [SOURCE – Document Title]"
  ],
  "clinicalCorrelation": "Per RSNA/CDC guidelines, imaging findings should be correlated with clinical presentation and patient history.",
  "disclaimer": "This system does not provide medical diagnoses. Interpret in clinical context."
}`
      : `You are a friendly assistant helping patients understand medical imaging in simple terms. Use ONLY the provided RSNA/CDC guideline context.

${retrievedContext}

${citationInstructions}

YOUR ROLE:
- Explain what this type of imaging test is for in very simple words
- Help patients feel informed and calm
- Keep explanations short (2-4 sentences maximum)
- Focus on the PURPOSE of the test, not interpretation of results

LANGUAGE STYLE:
- Very simple, everyday words (no medical jargon)
- Warm, calm, reassuring tone
- Short sentences
- Example phrases: "This type of scan helps doctors see...", "It's commonly used to look at..."

STRICTLY PROHIBITED:
- Medical terminology or jargon
- Any words like: "abnormal", "concerning", "urgent", "critical", "dangerous"
- Mentioning diseases, conditions, or diagnoses
- Interpreting or explaining specific findings
- Long or complex explanations

OUTPUT FORMAT (simple, short, reassuring):
Respond in JSON format:
{
  "summary": "A simple 2-4 sentence explanation of what this imaging test is used for, written for someone with no medical background. End with: 'This system does not provide medical diagnoses.'",
  "items": [
    {
      "name": "What this test looks at",
      "value": "Simple description",
      "explanation": "One simple sentence about this aspect [SOURCE – Document Title]",
      "status": "normal"
    }
  ],
  "simpleExplanation": "This scan is a way for doctors to see inside your body to check on [body area]. It helps your doctor understand what's going on.",
  "reassurance": "Your doctor will explain your results and answer any questions you have.",
  "disclaimer": "This system does not provide medical diagnoses. Please talk to your doctor about your results."
}`;

    console.log("Calling Lovable AI Gateway for citation-aware analysis...");

    // Step 5: Call LLM with context-injected prompt
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: baseSystemPrompt },
          { 
            role: "user", 
            content: [
              {
                type: "text",
                text: "Analyze this medical image using ONLY the provided RSNA/CDC context. Include inline citations for all statements."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${fileType};base64,${imageBase64}`
                }
              }
            ]
          }
        ],
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Service quota exceeded. Please try again later." }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Failed to analyze report" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("No content in response:", data);
      return new Response(
        JSON.stringify({ error: "No analysis generated" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 6: Parse and validate response
    let parsedResult;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const jsonString = jsonMatch[1].trim();
      parsedResult = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("Failed to parse AI response as JSON:", parseError);
      console.log("Raw content:", content);
      parsedResult = {
        summary: content,
        riskLevel: "moderate",
        criticalFindings: [],
        items: [],
        rawResponse: true
      };
    }

    // Ensure required fields are always present
    if (!parsedResult.disclaimer) {
      parsedResult.disclaimer = mode === "clinician"
        ? "This analysis is for informational purposes only. Clinical correlation required. Not a diagnostic conclusion."
        : "This is not a medical diagnosis. Please consult a qualified healthcare professional for accurate interpretation.";
    }
    
    // Add structured reference list (deduplicated)
    parsedResult.references = references;
    parsedResult.ragSourcesUsed = true;
    parsedResult.reportTypeDetected = reportType;

    console.log("=== CITATION-AWARE RAG WORKFLOW COMPLETE ===");
    console.log(`References included: ${references.length}`);

    return new Response(
      JSON.stringify(parsedResult),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in analyze-report function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error occurred" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
