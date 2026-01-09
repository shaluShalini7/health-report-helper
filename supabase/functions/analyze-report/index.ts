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
    console.error("Report type detection failed:", await response.text());
    return { type: "other", extractedText: "" };
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
      type: parsed.reportType || "other",
      extractedText: fullText
    };
  } catch {
    return { type: "other", extractedText: content };
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
      const chunksWithTitles = await hybridSearchWithTitles(
        supabase,
        queryEmbedding,
        extractedText,
        reportType,
        undefined
      );

      // FALLBACK: If no relevant documents retrieved, return immediately without calling LLM
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
      ? `You are a medical report analysis assistant for healthcare professionals. Analyze the uploaded medical image or report using ONLY the provided RSNA/CDC guideline context.

${retrievedContext}

${citationInstructions}

YOUR ROLE:
- Provide structured, clinically relevant insights grounded in the provided guidelines
- Extract medically relevant features and observations from the image
- Reference the specific guidelines that support your observations

OUTPUT FORMAT (use standard medical terminology, include inline citations):
Respond in JSON format:
{
  "summary": "Clinical summary with inline citations [SOURCE – Document Title] for each key point",
  "riskLevel": "low" | "moderate" | "high",
  "criticalFindings": ["Array of notable observations with citations"],
  "items": [
    {
      "name": "Test/Finding name",
      "value": "Value or observation",
      "unit": "Unit if applicable",
      "referenceRange": "Normal range if applicable",
      "status": "normal" | "abnormal" | "critical",
      "explanation": "Clinical significance with citation [SOURCE – Document Title]"
    }
  ],
  "anatomicalRegions": ["Regions involved if applicable"],
  "deviations": ["Notable abnormalities with citations"],
  "imageQuality": "Notes on image/report quality if relevant",
  "recommendation": "Further clinical correlation advised - no treatment recommendations",
  "disclaimer": "This analysis is for informational purposes only. Clinical correlation required. Not a diagnostic conclusion."
}

STRICT RULES:
- NO final diagnosis
- NO treatment recommendations
- NO prescription suggestions
- ALL statements must cite the source context
- Risk levels are QUALITATIVE indicators only
- Always include: "Further clinical correlation advised"
- Never provide definitive diagnostic conclusions`
      : `You are a friendly medical report explanation assistant helping patients understand their results. Use ONLY the provided RSNA/CDC guideline context to explain the findings.

${retrievedContext}

${citationInstructions}

YOUR PURPOSE:
- Help patients understand their uploaded image or report
- Use simple, easy-to-understand language
- Ground all explanations in the provided medical guidelines
- Include citations to show where information comes from

ANALYSIS RULES:
- Explain findings in simple terms with citations
- Categorize overall findings into risk level: "low", "moderate", or "high"
- This risk classification is NON-DIAGNOSTIC and QUALITATIVE only

OUTPUT RULES BY RISK LEVEL:
If Risk is LOW or MODERATE:
- Use calm, reassuring language
- Explain with simple terms and cite sources

If Risk is HIGH:
- Gently advise professional consultation
- Avoid panic-inducing language
- Use wording like: "Some findings may require attention. Please consult a doctor for evaluation."

Respond in JSON format:
{
  "summary": "Simple summary with inline citations [SOURCE – Document Title] for each key point",
  "riskLevel": "low" | "moderate" | "high",
  "criticalFindings": ["Findings that may need attention - simple language with citations"],
  "items": [
    {
      "name": "Test or finding name",
      "value": "Value or observation",
      "unit": "Unit if applicable",
      "status": "normal" | "abnormal" | "critical",
      "explanation": "Simple explanation with citation [SOURCE – Document Title]"
    }
  ],
  "overallAssessment": "normal" | "slightly unusual" | "needs professional review",
  "questionsToAsk": ["Helpful questions to ask your doctor"],
  "reassurance": "Encouraging, calming message emphasizing safety and next steps",
  "disclaimer": "This is not a medical diagnosis. Please consult a qualified healthcare professional for accurate interpretation."
}

STRICTLY PROHIBITED (NEVER DO):
- Disease prediction or naming
- Diagnosis statements
- Treatment or medication advice
- Information not in the provided context
- Statements without citations`;

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
