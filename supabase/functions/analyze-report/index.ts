import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "API key not configured" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = mode === "clinician" 
      ? `You are a medical report analysis assistant for healthcare professionals. Analyze the uploaded medical report image and provide:
1. A structured clinical summary with medical terminology
2. Extract all test names, values, units, and reference ranges
3. Identify any abnormal or critical values
4. Provide bullet-point findings
5. Suggest relevant clinical considerations (NOT diagnoses or treatment recommendations)

IMPORTANT SAFETY RULES:
- Do NOT provide diagnoses or treatment recommendations
- Highlight critical/abnormal values clearly
- Always recommend consulting with the ordering physician
- Acknowledge any OCR/image quality limitations

Respond in JSON format:
{
  "summary": "Brief clinical summary",
  "criticalFindings": ["Array of critical findings requiring attention"],
  "items": [
    {
      "name": "Test name",
      "value": "Value",
      "unit": "Unit",
      "referenceRange": "Normal range",
      "status": "normal" | "abnormal" | "critical",
      "explanation": "Clinical significance"
    }
  ],
  "clinicalNotes": "Additional clinical observations",
  "limitations": "Any quality/OCR issues noted"
}`
      : `You are a friendly medical report explanation assistant helping patients understand their results. Analyze the uploaded medical report image and provide:
1. A simple, easy-to-understand summary in plain language
2. Explain what each test measures in simple terms
3. Clearly indicate if values are normal, high, or low
4. Suggest questions the patient might want to ask their doctor

IMPORTANT SAFETY RULES:
- Do NOT provide diagnoses or treatment recommendations
- Use simple, non-technical language
- Highlight concerning values with clear warnings
- Always encourage consulting with their doctor
- Be reassuring but honest
- Acknowledge any image quality issues

Respond in JSON format:
{
  "summary": "Simple summary of overall results",
  "criticalFindings": ["Array of findings that need doctor attention - use simple language"],
  "items": [
    {
      "name": "Test name",
      "value": "Value",
      "unit": "Unit",
      "status": "normal" | "abnormal" | "critical",
      "explanation": "Simple explanation of what this means and why it matters"
    }
  ],
  "questionsToAsk": ["Array of questions to ask your doctor"],
  "reassurance": "Encouraging message about next steps"
}`;

    console.log("Calling Lovable AI Gateway for medical report analysis...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: [
              {
                type: "text",
                text: "Please analyze this medical report image and provide the structured analysis as specified."
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

    // Parse the JSON response from the AI
    let parsedResult;
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const jsonString = jsonMatch[1].trim();
      parsedResult = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("Failed to parse AI response as JSON:", parseError);
      console.log("Raw content:", content);
      // Return raw content if JSON parsing fails
      parsedResult = {
        summary: content,
        criticalFindings: [],
        items: [],
        questionsToAsk: [],
        rawResponse: true
      };
    }

    console.log("Successfully analyzed medical report");

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
