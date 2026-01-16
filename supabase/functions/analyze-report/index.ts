import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// SAFE RESPONSE SCHEMA - Complete structure for both modes
interface SafeResponse {
  reportType: string;
  mode: "patient" | "clinician";
  // Patient Mode fields
  whatThisTestIsAbout: string | null;
  simpleImageExplanation: string | null;
  summary: string;
  possibleRiskFactors: string | null;
  whyConsultDoctor: string | null;
  reassurance: string | null;
  // Clinician Mode fields
  imagingTypeAndRegion: string | null;
  keyObservations: string[] | null;
  impression: string | null;
  recommendation: string | null;
  // Common fields
  references: string[];
  disclaimer: string;
}

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

// Create safe fallback response
function createSafeResponse(mode: "patient" | "clinician", reportType: string, message?: string): SafeResponse {
  const defaultDisclaimer = "⚠️ This explanation is for educational purposes only and is not a medical diagnosis.";
  
  const formattedType = formatReportTypeName(reportType);
  
  if (mode === "patient") {
    return {
      reportType,
      mode,
      whatThisTestIsAbout: `A ${formattedType} is a type of scan that takes detailed pictures of the inside of your body to help doctors understand what is happening.`,
      simpleImageExplanation: "This image shows internal body structures that doctors usually check for size, shape, and any unusual changes.",
      summary: message || "The scan shows areas that doctors carefully look at to understand your health. By itself, this image does not confirm any illness.",
      possibleRiskFactors: "Doctors often consider factors like age, lifestyle, long-term conditions, or previous medical history when reviewing scans like this.",
      whyConsultDoctor: "Only a doctor can review this image along with your symptoms and medical history to explain what it means for you.",
      reassurance: "Many scan findings are common and manageable. Your doctor will guide you clearly on the next steps.",
      imagingTypeAndRegion: null,
      keyObservations: null,
      impression: null,
      recommendation: null,
      references: [],
      disclaimer: defaultDisclaimer,
    };
  }
  
  return {
    reportType,
    mode,
    whatThisTestIsAbout: null,
    simpleImageExplanation: null,
    summary: message || "Imaging study received. Guideline-based interpretation requires clinical correlation.",
    possibleRiskFactors: null,
    whyConsultDoctor: null,
    reassurance: null,
    imagingTypeAndRegion: `Imaging: ${formattedType}\nRegion: To be determined based on clinical context`,
    keyObservations: [
      "• Structural patterns noted",
      "• Density / contrast variations observed",
      "• Areas requiring clinical correlation"
    ],
    impression: "Imaging features warrant clinical correlation with patient history and additional investigations if indicated.",
    recommendation: "Correlation with clinical findings and formal radiology report is advised.",
    references: [],
    disclaimer: "AI-generated educational summary. Not a substitute for formal radiological interpretation.",
  };
}

function formatReportTypeName(type: string): string {
  const typeMap: Record<string, string> = {
    ct: "CT Scan",
    mri: "MRI",
    xray: "X-Ray",
    lab: "Lab Report"
  };
  return typeMap[type.toLowerCase()] || type.toUpperCase();
}

// Generate embedding using Gemini API with fallback
async function generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  console.log("Generating embedding for query text...");
  
  try {
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
      console.error("Embedding API error:", response.status);
      return null;
    }

    const data = await response.json();
    return data.embedding?.values || null;
  } catch (error) {
    console.error("Embedding generation error:", error);
    return null;
  }
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

// Perform hybrid search with fallbacks
async function hybridSearchWithTitles(
  supabase: any,
  queryEmbedding: number[],
  queryText: string,
  reportType?: string
): Promise<ChunkWithTitle[]> {
  console.log("Performing hybrid search...");
  
  try {
    const keywords = extractKeywords(queryText);
    console.log("Extracted keywords:", keywords);

    // First try with report type filter
    let { data, error } = await supabase.rpc('hybrid_search', {
      query_embedding: JSON.stringify(queryEmbedding),
      query_text: keywords,
      filter_report_type: reportType || null,
      filter_category: null,
      match_count: 10,
      vector_weight: 0.7,
      text_weight: 0.3
    });

    if (error) {
      console.error("Hybrid search error:", error);
      return [];
    }

    let chunks = (data as RetrievedChunk[] | null) || [];
    console.log(`Retrieved ${chunks.length} chunks with filter`);

    // FALLBACK: If no results with filter, try without
    if (chunks.length === 0 && reportType) {
      console.log("Retrying without report type filter...");
      const fallbackResult = await supabase.rpc('hybrid_search', {
        query_embedding: JSON.stringify(queryEmbedding),
        query_text: keywords,
        filter_report_type: null,
        filter_category: null,
        match_count: 10,
        vector_weight: 0.7,
        text_weight: 0.3
      });
      
      if (!fallbackResult.error) {
        chunks = (fallbackResult.data as RetrievedChunk[] | null) || [];
        console.log(`Retrieved ${chunks.length} chunks without filter`);
      }
    }

    if (chunks.length === 0) {
      return [];
    }

    // Enrich with document titles
    const documentIds = [...new Set(chunks.map(c => c.document_id))];
    const { data: documents } = await supabase
      .from('knowledge_documents')
      .select('id, title')
      .in('id', documentIds);

    const titleMap = new Map<string, string>();
    for (const doc of documents || []) {
      titleMap.set(doc.id, doc.title);
    }

    return chunks.map(chunk => ({
      ...chunk,
      document_title: titleMap.get(chunk.document_id) || "Medical Guidelines"
    }));
  } catch (error) {
    console.error("Hybrid search exception:", error);
    return [];
  }
}

// Apply safety filtering
function applySafetyFilter(chunks: ChunkWithTitle[], mode: string): SafeContext[] {
  const unsafeCategories = ['diagnosis', 'treatment', 'prescription', 'medication'];
  
  let filteredChunks = chunks.filter(chunk => {
    const category = chunk.content_category.toLowerCase();
    return !unsafeCategories.some(unsafe => category.includes(unsafe));
  });

  if (mode === 'patient') {
    filteredChunks = filteredChunks.filter(chunk => {
      const category = chunk.content_category.toLowerCase();
      return !category.includes('clinical_protocol') && !category.includes('research');
    });
  }

  return filteredChunks.map(chunk => ({
    content: chunk.content,
    source: chunk.source,
    document_title: chunk.document_title,
    category: chunk.content_category
  }));
}

// Build context string
function buildContext(safeContexts: SafeContext[]): string {
  if (safeContexts.length === 0) return "";

  const contextParts = safeContexts.map(ctx => 
    `[${ctx.source} – ${ctx.document_title}]\n${ctx.content}`
  );

  return `CONTEXT:\n---\n${contextParts.join('\n\n')}\n---`;
}

// Extract references
function extractReferences(safeContexts: SafeContext[]): string[] {
  const seen = new Set<string>();
  const references: string[] = [];

  for (const ctx of safeContexts) {
    const refString = `[${ctx.source}] ${ctx.document_title}`;
    if (!seen.has(refString)) {
      seen.add(refString);
      references.push(refString);
    }
  }

  return references;
}

// Detect report type with safe fallback - NEVER returns "other"
async function detectReportType(imageBase64: string, fileType: string, apiKey: string): Promise<{ type: string; extractedText: string }> {
  console.log("Detecting report type...");
  
  const defaultFallback = { 
    type: "ct", 
    extractedText: "medical imaging scan computed tomography abdominal chest radiograph" 
  };
  
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
            content: `Analyze this medical image. Identify the type and extract text.
Respond in JSON: {"reportType": "ct"|"mri"|"xray"|"lab", "extractedText": "visible text and observations"}`
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Classify this medical image." },
              { type: "image_url", image_url: { url: `data:${fileType};base64,${imageBase64}` } }
            ]
          }
        ],
        max_tokens: 1024,
      }),
    });

    // Handle API errors gracefully
    if (!response.ok) {
      console.error("Detection API error:", response.status);
      return defaultFallback;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const parsed = JSON.parse(jsonMatch[1].trim());
      
      // Normalize report type - NEVER allow "other"
      let normalizedType = (parsed.reportType || "ct").toLowerCase();
      if (!["ct", "mri", "xray", "lab"].includes(normalizedType)) {
        normalizedType = "ct";
      }
      
      return {
        type: normalizedType,
        extractedText: parsed.extractedText || "medical imaging scan"
      };
    } catch {
      return defaultFallback;
    }
  } catch (error) {
    console.error("Detection exception:", error);
    return defaultFallback;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64, fileType, mode = "patient" } = await req.json();
    const safeMode = mode === "clinician" ? "clinician" : "patient";
    
    if (!imageBase64) {
      return new Response(
        JSON.stringify(createSafeResponse(safeMode, "unknown", "No image provided. Please upload a valid medical report.")),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      return new Response(
        JSON.stringify(createSafeResponse(safeMode, "unknown", "Service configuration error. Please try again later.")),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: Detect report type (fail-safe)
    console.log("=== RESILIENT WORKFLOW START ===");
    const { type: reportType, extractedText } = await detectReportType(imageBase64, fileType, LOVABLE_API_KEY);
    console.log(`Report type: ${reportType}`);

    // Step 2: RAG Retrieval with fallbacks
    let safeContexts: SafeContext[] = [];
    let references: string[] = [];
    let ragSucceeded = false;
    
    if (GEMINI_API_KEY && extractedText.length >= 10) {
      try {
        const queryEmbedding = await generateEmbedding(extractedText, GEMINI_API_KEY);
        
        if (queryEmbedding) {
          const chunks = await hybridSearchWithTitles(supabase, queryEmbedding, extractedText, reportType);
          
          if (chunks.length > 0) {
            safeContexts = applySafetyFilter(chunks, safeMode);
            references = extractReferences(safeContexts);
            ragSucceeded = safeContexts.length > 0;
            console.log(`RAG retrieved ${safeContexts.length} safe contexts`);
          }
        }
      } catch (ragError) {
        console.error("RAG error (continuing without):", ragError);
      }
    }

    // Step 3: Build context for LLM
    const retrievedContext = ragSucceeded ? buildContext(safeContexts) : "";
    const contextNote = ragSucceeded 
      ? "Use ONLY the provided CONTEXT to generate your response." 
      : "No specific guidelines retrieved. Provide general educational information about this imaging type.";

    const formattedType = formatReportTypeName(reportType);

    // Step 4: Build mode-specific prompts with COMPLETE structured output
    const systemPrompt = safeMode === "clinician" 
      ? `You are a radiology education assistant for healthcare professionals.

${retrievedContext}

${contextNote}

IMAGING TYPE: ${formattedType}

MANDATORY OUTPUT STRUCTURE (JSON):
{
  "imagingTypeAndRegion": "Imaging: ${formattedType}\\nRegion: [detected or 'Unspecified']",
  "keyObservations": [
    "• [Observation 1 using standard medical terminology]",
    "• [Observation 2 - describe only what is visible]",
    "• [Observation 3 - areas requiring correlation]"
  ],
  "impression": "[2-3 lines, non-diagnostic. Example: 'Imaging features warrant clinical correlation with patient history and additional investigations if indicated.']",
  "recommendation": "Correlation with clinical findings and formal radiology report is advised.",
  "disclaimer": "AI-generated educational summary. Not a substitute for formal radiological interpretation."
}

RULES:
- Use concise medical terminology
- Present key observations as bullet points
- Only describe what is visible - never hallucinate findings
- No disease confirmation or diagnosis
- No urgency labels ("critical", "emergent", "urgent")
- No treatment recommendations`
      : `You are a friendly assistant helping patients understand medical imaging.

${retrievedContext}

${contextNote}

IMAGING TYPE: ${formattedType}

MANDATORY OUTPUT STRUCTURE (JSON):
{
  "whatThisTestIsAbout": "A ${formattedType} is a type of scan that [simple 1-2 sentence explanation of what this imaging does].",
  "simpleImageExplanation": "[Explain what is visible in the image using plain language. Avoid medical terms or explain them in brackets. Example: 'This image shows internal body structures that doctors usually check for size, shape, and any unusual changes.']",
  "summary": "[2-3 lines max. State that the image shows patterns doctors review and does NOT confirm a disease. Example: 'The scan shows areas that doctors carefully look at to understand your health. By itself, this image does not confirm any illness.']",
  "possibleRiskFactors": "Doctors often consider factors like age, lifestyle, long-term conditions, or previous medical history when reviewing scans like this.",
  "whyConsultDoctor": "Only a doctor can review this image along with your symptoms and medical history to explain what it means for you.",
  "reassurance": "Many scan findings are common and manageable. Your doctor will guide you clearly on the next steps.",
  "disclaimer": "⚠️ This explanation is for educational purposes only and is not a medical diagnosis."
}

RULES:
- Use very simple, everyday words a child could understand
- Keep explanations short (2-4 sentences max per section)
- Focus on what the test IS FOR, not specific results
- Be calm and reassuring throughout
- NEVER use these words: abnormal, concerning, urgent, critical, dangerous, serious, worrying

PROHIBITED:
- Medical jargon without explanation
- Disease names or diagnoses
- Specific findings interpretation
- Any language that could cause anxiety`;

    // Step 5: Call LLM with error handling
    console.log("Calling AI for analysis...");
    
    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { 
              role: "user", 
              content: [
                { type: "text", text: "Analyze this medical image and provide a structured educational explanation." },
                { type: "image_url", image_url: { url: `data:${fileType};base64,${imageBase64}` } }
              ]
            }
          ],
          max_tokens: 2048,
        }),
      });

      // Handle ALL errors gracefully - ALWAYS return 200 with safe data
      if (response.status === 429 || response.status === 402 || !response.ok) {
        console.error("AI API error:", response.status);
        const fallback = createSafeResponse(safeMode, reportType);
        fallback.references = references;
        return new Response(
          JSON.stringify(fallback),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        const fallback = createSafeResponse(safeMode, reportType);
        fallback.references = references;
        return new Response(
          JSON.stringify(fallback),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Step 6: Parse response safely
      let parsedResult: any;
      try {
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
        parsedResult = JSON.parse(jsonMatch[1].trim());
      } catch {
        // If parsing fails, use content as summary
        parsedResult = { summary: content.substring(0, 500) };
      }

      // Build final safe response with all required fields
      const defaultResponse = createSafeResponse(safeMode, reportType);
      
      const finalResponse: SafeResponse = {
        reportType,
        mode: safeMode,
        // Patient Mode fields
        whatThisTestIsAbout: safeMode === "patient" 
          ? (parsedResult.whatThisTestIsAbout || defaultResponse.whatThisTestIsAbout) 
          : null,
        simpleImageExplanation: safeMode === "patient" 
          ? (parsedResult.simpleImageExplanation || defaultResponse.simpleImageExplanation) 
          : null,
        summary: parsedResult.summary || defaultResponse.summary,
        possibleRiskFactors: safeMode === "patient" 
          ? (parsedResult.possibleRiskFactors || defaultResponse.possibleRiskFactors) 
          : null,
        whyConsultDoctor: safeMode === "patient" 
          ? (parsedResult.whyConsultDoctor || defaultResponse.whyConsultDoctor) 
          : null,
        reassurance: safeMode === "patient" 
          ? (parsedResult.reassurance || defaultResponse.reassurance) 
          : null,
        // Clinician Mode fields
        imagingTypeAndRegion: safeMode === "clinician" 
          ? (parsedResult.imagingTypeAndRegion || defaultResponse.imagingTypeAndRegion) 
          : null,
        keyObservations: safeMode === "clinician" 
          ? (parsedResult.keyObservations || defaultResponse.keyObservations) 
          : null,
        impression: safeMode === "clinician" 
          ? (parsedResult.impression || defaultResponse.impression) 
          : null,
        recommendation: safeMode === "clinician" 
          ? (parsedResult.recommendation || defaultResponse.recommendation) 
          : null,
        // Common fields
        references,
        disclaimer: parsedResult.disclaimer || defaultResponse.disclaimer,
      };

      console.log("=== WORKFLOW COMPLETE ===");
      
      return new Response(
        JSON.stringify(finalResponse),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (llmError) {
      console.error("LLM call failed:", llmError);
      const fallback = createSafeResponse(safeMode, reportType);
      fallback.references = references;
      return new Response(
        JSON.stringify(fallback),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error("Request error:", error);
    return new Response(
      JSON.stringify(createSafeResponse("patient", "unknown", "An error occurred. Please try again.")),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
