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
  content_category: string;
  report_type: string;
  source: string;
  similarity: number;
  text_rank: number;
  combined_score: number;
}

interface SafeContext {
  content: string;
  source: string;
  category: string;
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
  // Remove common stop words and extract meaningful medical terms
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

  // Return unique keywords joined for PostgreSQL text search
  return [...new Set(words)].slice(0, 20).join(' | ');
}

// Perform hybrid search using both vector similarity and text search
async function hybridSearch(
  supabase: any,
  queryEmbedding: number[],
  queryText: string,
  reportType?: string,
  contentCategory?: string
): Promise<RetrievedChunk[]> {
  console.log("Performing hybrid search...");
  
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

  const results = data as RetrievedChunk[] | null;
  console.log(`Retrieved ${results?.length || 0} chunks from knowledge base`);
  return results || [];
}

// Apply safety filtering based on user mode
function applySafetyFilter(chunks: RetrievedChunk[], mode: string): SafeContext[] {
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
        category: chunk.content_category
      }));
  }

  // For clinician mode, allow more technical content
  return filteredChunks.map(chunk => ({
    content: chunk.content,
    source: chunk.source,
    category: chunk.content_category
  }));
}

// Build context string from retrieved and filtered content
function buildContext(safeContexts: SafeContext[]): string {
  if (safeContexts.length === 0) {
    return "";
  }

  const contextParts = safeContexts.map((ctx, index) => 
    `[Reference ${index + 1}] (Source: ${ctx.source}, Category: ${ctx.category})\n${ctx.content}`
  );

  return `
MEDICAL REFERENCE CONTEXT (from verified sources):
=====================================
${contextParts.join('\n\n')}
=====================================

IMPORTANT: Base your analysis ONLY on the information provided in the uploaded image/report AND the reference context above. Do not use any external knowledge.
`;
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
    console.log("=== RAG WORKFLOW START ===");
    const { type: reportType, extractedText } = await detectReportType(imageBase64, fileType, LOVABLE_API_KEY);
    console.log(`Detected report type: ${reportType}`);
    console.log(`Extracted text length: ${extractedText.length} characters`);

    // Step 2: Generate embedding for retrieval query
    let retrievedContext = "";
    let usedRAG = false;
    
    if (GEMINI_API_KEY && extractedText.length > 20) {
      try {
        const queryEmbedding = await generateEmbedding(extractedText, GEMINI_API_KEY);
        
        // Step 3: Perform hybrid search
        const retrievedChunks = await hybridSearch(
          supabase,
          queryEmbedding,
          extractedText,
          reportType,
          undefined
        );

        if (retrievedChunks.length > 0) {
          // Step 4: Apply safety filtering
          const safeContexts = applySafetyFilter(retrievedChunks, mode);
          
          // Step 5: Build context for LLM
          retrievedContext = buildContext(safeContexts);
          usedRAG = true;
          console.log(`RAG context built with ${safeContexts.length} safe references`);
        } else {
          console.log("No relevant documents found in knowledge base");
        }
      } catch (embeddingError) {
        console.error("Embedding/retrieval error:", embeddingError);
        // Continue without RAG if embedding fails
      }
    } else {
      console.log("Skipping RAG: No GEMINI_API_KEY or insufficient extracted text");
    }

    // Step 6: Build system prompt with RAG context
    const baseSystemPrompt = mode === "clinician" 
      ? `You are a medical report analysis assistant for healthcare professionals. Analyze the uploaded medical image or report (X-ray, MRI, CT, radiology images, lab reports, etc.).

${retrievedContext}

YOUR ROLE:
- Provide quick, structured, and clinically relevant insights
- Perform deeper technical analysis of the uploaded data
- Extract medically relevant features and observations
- Focus ONLY on findings directly related to the uploaded data
- ${usedRAG ? "Ground your explanations in the provided reference context" : "Provide general medical observations only"}

OUTPUT FORMAT (use standard medical terminology, short bullet-point format):
Respond in JSON format:
{
  "summary": "Brief clinical summary of key findings",
  "riskLevel": "low" | "moderate" | "high",
  "criticalFindings": ["Array of notable observations requiring attention"],
  "items": [
    {
      "name": "Test/Finding name",
      "value": "Value or observation",
      "unit": "Unit if applicable",
      "referenceRange": "Normal range if applicable",
      "status": "normal" | "abnormal" | "critical",
      "explanation": "Clinical significance - brief, technical"
    }
  ],
  "anatomicalRegions": ["Regions involved if applicable"],
  "deviations": ["Notable abnormalities or deviations"],
  "imageQuality": "Notes on image/report quality if relevant",
  "recommendation": "Further clinical correlation advised - no treatment recommendations",
  "ragSourcesUsed": ${usedRAG},
  "disclaimer": "This analysis is for informational purposes only. Clinical correlation required. Not a diagnostic conclusion."
}

STRICT RULES:
- NO final diagnosis
- NO treatment recommendations
- NO prescription suggestions
- Risk levels (Low/Moderate/High) are QUALITATIVE indicators only
- Always include: "Further clinical correlation advised"
- Never provide definitive diagnostic conclusions
- ${usedRAG ? "Only use information from the uploaded image and provided reference context" : "Provide observations based solely on the uploaded image"}`
      : `You are a friendly medical report explanation assistant helping patients understand their results. Analyze the uploaded medical image or report (X-ray, MRI, CT, radiology images, lab reports, etc.).

${retrievedContext}

YOUR PURPOSE:
- Help patients understand their uploaded image or report
- Use very simple, easy-to-understand language (layman-friendly)
- Maintain a calm, reassuring, neutral tone
- Avoid medical jargon - explain it simply if unavoidable
- ${usedRAG ? "Use the provided medical references to give accurate, grounded explanations" : "Provide general observations only"}

ANALYSIS RULES:
- Identify general visual or textual indicators
- Categorize overall findings into risk level: "low", "moderate", or "high"
- This risk classification is NON-DIAGNOSTIC and QUALITATIVE only

OUTPUT RULES BY RISK LEVEL:
If Risk is LOW or MODERATE:
- Use calm, reassuring language
- Explain findings in simple, everyday terms
- Do NOT urge immediate medical action
- Example tone: "Some differences are visible, but this does not necessarily indicate a serious issue."

If Risk is HIGH:
- Gently and clearly advise professional consultation
- Avoid panic-inducing language
- Do NOT name diseases or conditions
- Use wording like: "Some findings appear more concerning and may require attention. It would be a good idea to consult a qualified doctor as soon as possible for a detailed medical evaluation."

Respond in JSON format:
{
  "summary": "Simple, easy-to-understand summary of overall results",
  "riskLevel": "low" | "moderate" | "high",
  "criticalFindings": ["Array of findings that may need doctor attention - simple language, no disease names"],
  "items": [
    {
      "name": "Test or finding name",
      "value": "Value or observation",
      "unit": "Unit if applicable",
      "status": "normal" | "abnormal" | "critical",
      "explanation": "Simple explanation of what this means - like talking to a non-medical person"
    }
  ],
  "overallAssessment": "normal" | "slightly unusual" | "needs professional review",
  "questionsToAsk": ["Array of helpful questions to ask your doctor"],
  "reassurance": "Encouraging, calming message emphasizing safety and next steps",
  "ragSourcesUsed": ${usedRAG},
  "disclaimer": "This is not a medical diagnosis. Please consult a qualified healthcare professional for accurate interpretation."
}

STRICTLY PROHIBITED (NEVER DO):
- Disease prediction
- Disease naming (no specific condition names)
- Diagnosis statements
- Treatment or medication advice
- Severity percentages or scores
- Panic-inducing language

MANDATORY:
- Always include a safety disclaimer
- Always emphasize consulting a healthcare professional
- Be reassuring but honest about uncertainty
- ${usedRAG ? "Only use information from the uploaded image and provided reference context" : "Base observations solely on the uploaded image"}`;

    console.log("Calling Lovable AI Gateway for medical report analysis...");

    // Step 7: Call LLM with context-injected prompt
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
                text: `Please analyze this medical image or report and provide the structured analysis as specified. Remember to follow all safety rules strictly.${usedRAG ? " Ground your explanations in the provided medical reference context." : ""}`
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

    // Step 8: Parse and validate response
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
        questionsToAsk: [],
        ragSourcesUsed: usedRAG,
        disclaimer: "This is not a medical diagnosis. Please consult a qualified healthcare professional for accurate interpretation.",
        rawResponse: true
      };
    }

    // Ensure required fields are always present
    if (!parsedResult.disclaimer) {
      parsedResult.disclaimer = mode === "clinician"
        ? "This analysis is for informational purposes only. Clinical correlation required. Not a diagnostic conclusion."
        : "This is not a medical diagnosis. Please consult a qualified healthcare professional for accurate interpretation.";
    }
    
    parsedResult.ragSourcesUsed = usedRAG;
    parsedResult.reportTypeDetected = reportType;

    console.log("=== RAG WORKFLOW COMPLETE ===");
    console.log(`RAG used: ${usedRAG}, Report type: ${reportType}`);

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
