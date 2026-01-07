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
      ? `You are a medical report analysis assistant for healthcare professionals. Analyze the uploaded medical image or report (X-ray, MRI, CT, radiology images, lab reports, etc.).

YOUR ROLE:
- Provide quick, structured, and clinically relevant insights
- Perform deeper technical analysis of the uploaded data
- Extract medically relevant features and observations
- Focus ONLY on findings directly related to the uploaded data

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
  "disclaimer": "This analysis is for informational purposes only. Clinical correlation required. Not a diagnostic conclusion."
}

STRICT RULES:
- NO final diagnosis
- NO treatment recommendations
- NO prescription suggestions
- Risk levels (Low/Moderate/High) are QUALITATIVE indicators only
- Always include: "Further clinical correlation advised"
- Never provide definitive diagnostic conclusions`
      : `You are a friendly medical report explanation assistant helping patients understand their results. Analyze the uploaded medical image or report (X-ray, MRI, CT, radiology images, lab reports, etc.).

YOUR PURPOSE:
- Help patients understand their uploaded image or report
- Use very simple, easy-to-understand language (layman-friendly)
- Maintain a calm, reassuring, neutral tone
- Avoid medical jargon - explain it simply if unavoidable

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
- Be reassuring but honest about uncertainty`;

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
                text: "Please analyze this medical image or report and provide the structured analysis as specified. Remember to follow all safety rules strictly."
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
        riskLevel: "moderate",
        criticalFindings: [],
        items: [],
        questionsToAsk: [],
        disclaimer: "This is not a medical diagnosis. Please consult a qualified healthcare professional for accurate interpretation.",
        rawResponse: true
      };
    }

    // Ensure disclaimer is always present
    if (!parsedResult.disclaimer) {
      parsedResult.disclaimer = mode === "clinician"
        ? "This analysis is for informational purposes only. Clinical correlation required. Not a diagnostic conclusion."
        : "This is not a medical diagnosis. Please consult a qualified healthcare professional for accurate interpretation.";
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
