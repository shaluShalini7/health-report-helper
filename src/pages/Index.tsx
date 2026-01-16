import { useState } from "react";
import { 
  Upload, 
  FileText, 
  Shield, 
  Brain, 
  AlertTriangle, 
  ArrowRight,
  BookOpen,
  Stethoscope,
  MessageCircle,
  Heart,
  UserCheck,
  Activity,
  ClipboardList,
  CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { FileUpload } from "@/components/FileUpload";
import { ModeToggle } from "@/components/ModeToggle";
import { ProcessingLoader } from "@/components/ProcessingLoader";
import { FeatureCard } from "@/components/FeatureCard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type ViewState = "home" | "upload" | "processing" | "results";
type ProcessingStep = "extracting" | "analyzing" | "generating";

// Safe response interface matching backend schema - COMPLETE STRUCTURE
interface AnalysisResult {
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
  error?: string;
}

const Index = () => {
  const [view, setView] = useState<ViewState>("home");
  const [mode, setMode] = useState<"patient" | "clinician">("patient");
  const [processingStep, setProcessingStep] = useState<ProcessingStep>("extracting");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return;
    
    setView("processing");
    setProcessingStep("extracting");
    setError(null);

    try {
      // Convert file to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(selectedFile);
      const imageBase64 = await base64Promise;

      setProcessingStep("analyzing");

      // Call the edge function
      const { data, error: fnError } = await supabase.functions.invoke('analyze-report', {
        body: {
          imageBase64,
          fileType: selectedFile.type,
          mode
        }
      });

      // Handle function errors
      if (fnError) {
        const errorMsg = fnError.message?.toLowerCase() || "";
        if (errorMsg.includes('402') || errorMsg.includes('quota') || errorMsg.includes('credit') || errorMsg.includes('payment')) {
          throw new Error("Service temporarily unavailable. Please try again in a few minutes.");
        }
        throw new Error(fnError.message || "Failed to analyze report");
      }

      // Handle error in response body
      if (data?.error) {
        const errorMsg = data.error.toLowerCase();
        if (errorMsg.includes('quota') || errorMsg.includes('credit') || errorMsg.includes('rate limit')) {
          throw new Error("Service temporarily unavailable. Please try again in a few minutes.");
        }
        console.warn("Non-critical error:", data.error);
      }

      setProcessingStep("generating");
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Ensure data has required fields with defaults
      const safeData: AnalysisResult = {
        reportType: data?.reportType || "unknown",
        mode: data?.mode || mode,
        // Patient Mode fields
        whatThisTestIsAbout: data?.whatThisTestIsAbout || null,
        simpleImageExplanation: data?.simpleImageExplanation || null,
        summary: data?.summary || "Report analysis complete. Please consult your healthcare provider for interpretation.",
        possibleRiskFactors: data?.possibleRiskFactors || null,
        whyConsultDoctor: data?.whyConsultDoctor || null,
        reassurance: data?.reassurance || null,
        // Clinician Mode fields
        imagingTypeAndRegion: data?.imagingTypeAndRegion || null,
        keyObservations: Array.isArray(data?.keyObservations) ? data.keyObservations : null,
        impression: data?.impression || null,
        recommendation: data?.recommendation || null,
        // Common fields
        references: Array.isArray(data?.references) ? data.references : [],
        disclaimer: data?.disclaimer || "Educational use only. Not a medical diagnosis.",
      };

      setAnalysisResults(safeData);
      setView("results");
    } catch (err) {
      console.error("Analysis error:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to analyze report. Please try again.";
      setError(errorMessage);
      toast.error(errorMessage);
      setView("upload");
    }
  };

  const handleStartOver = () => {
    setView("home");
    setSelectedFile(null);
    setProcessingStep("extracting");
    setAnalysisResults(null);
    setError(null);
  };

  // Re-analyze with different mode - COMPLETE RE-RENDER
  const handleModeChange = async (newMode: "patient" | "clinician") => {
    if (newMode === mode) return;
    setMode(newMode);
    
    // If we have results and a file, re-analyze with new mode
    if (analysisResults && selectedFile) {
      setView("processing");
      setProcessingStep("analyzing");
      
      try {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
        });
        reader.readAsDataURL(selectedFile);
        const imageBase64 = await base64Promise;

        const { data, error: fnError } = await supabase.functions.invoke('analyze-report', {
          body: { imageBase64, fileType: selectedFile.type, mode: newMode }
        });

        if (fnError) throw fnError;

        const safeData: AnalysisResult = {
          reportType: data?.reportType || "unknown",
          mode: newMode,
          whatThisTestIsAbout: data?.whatThisTestIsAbout || null,
          simpleImageExplanation: data?.simpleImageExplanation || null,
          summary: data?.summary || "Report analysis complete.",
          possibleRiskFactors: data?.possibleRiskFactors || null,
          whyConsultDoctor: data?.whyConsultDoctor || null,
          reassurance: data?.reassurance || null,
          imagingTypeAndRegion: data?.imagingTypeAndRegion || null,
          keyObservations: Array.isArray(data?.keyObservations) ? data.keyObservations : null,
          impression: data?.impression || null,
          recommendation: data?.recommendation || null,
          references: Array.isArray(data?.references) ? data.references : [],
          disclaimer: data?.disclaimer || "Educational use only. Not a medical diagnosis.",
        };

        setAnalysisResults(safeData);
        setView("results");
      } catch (err) {
        console.error("Re-analysis error:", err);
        toast.error("Could not switch modes. Please try again.");
        setView("results");
      }
    }
  };

  const formatReportType = (type: string) => {
    const typeMap: Record<string, string> = {
      ct: "CT Scan",
      mri: "MRI",
      xray: "X-Ray",
      lab: "Lab Report"
    };
    return typeMap[type.toLowerCase()] || type.toUpperCase();
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {view === "home" && (
        <main className="container mx-auto px-4 py-12">
          {/* Hero Section */}
          <section className="text-center max-w-3xl mx-auto mb-16 animate-fade-in">
            <div className="inline-flex items-center gap-2 bg-accent/50 text-accent-foreground px-4 py-2 rounded-full text-sm font-medium mb-6">
              <Shield className="h-4 w-4" />
              Educational Use Only
            </div>
            <h1 className="font-heading text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
              Understand Your
              <span className="gradient-text"> Medical Reports</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Upload your medical imaging or lab reports and get clear, educational 
              explanations. For learning only—always consult your doctor.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button 
                variant="hero" 
                size="xl" 
                onClick={() => setView("upload")}
                className="w-full sm:w-auto"
              >
                Upload Your Report
                <ArrowRight className="h-5 w-5" />
              </Button>
              <Button 
                variant="hero-outline" 
                size="xl"
                className="w-full sm:w-auto"
              >
                <BookOpen className="h-5 w-5" />
                How It Works
              </Button>
            </div>
          </section>

          {/* Features Section */}
          <section className="max-w-5xl mx-auto mb-16">
            <div className="grid md:grid-cols-3 gap-6">
              <FeatureCard
                icon={FileText}
                title="Easy Upload"
                description="Upload PDF or image files. We support CT, MRI, X-ray, and lab reports."
              />
              <FeatureCard
                icon={Brain}
                title="AI Analysis"
                description="Our AI explains what the test is for and what doctors typically look at."
              />
              <FeatureCard
                icon={MessageCircle}
                title="Two Modes"
                description="Patient mode for simple explanations, Clinician mode for technical details."
              />
            </div>
          </section>

          {/* Disclaimer Section */}
          <section className="max-w-3xl mx-auto">
            <DisclaimerBanner variant="warning" />
          </section>
        </main>
      )}

      {view === "upload" && (
        <main className="container mx-auto px-4 py-12 animate-slide-up">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={handleStartOver}
              className="text-sm text-muted-foreground hover:text-foreground mb-6 flex items-center gap-1"
            >
              ← Back to home
            </button>
            
            <h2 className="font-heading text-3xl font-bold text-foreground mb-2">
              Upload Your Report
            </h2>
            <p className="text-muted-foreground mb-8">
              Select a PDF or image of your medical report.
            </p>

            {error && (
              <div className="mb-6 p-4 bg-destructive/10 border border-destructive/30 rounded-lg flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <FileUpload onFileSelect={handleFileSelect} />

            <div className="mt-8 space-y-6">
              <div>
                <label className="block text-sm font-medium text-foreground mb-3">
                  Choose Explanation Mode
                </label>
                <ModeToggle mode={mode} onModeChange={setMode} />
                <p className="text-sm text-muted-foreground mt-3">
                  {mode === "patient" 
                    ? "Simple, friendly explanations without medical jargon."
                    : "Technical details with guideline references for clinicians."}
                </p>
              </div>

              <Button
                variant="hero"
                size="lg"
                className="w-full"
                disabled={!selectedFile}
                onClick={handleAnalyze}
              >
                <Brain className="h-5 w-5" />
                Analyze Report
              </Button>

              <DisclaimerBanner variant="info" />
            </div>
          </div>
        </main>
      )}

      {view === "processing" && (
        <main className="container mx-auto px-4 py-12 animate-fade-in">
          <ProcessingLoader step={processingStep} />
          <p className="text-center text-muted-foreground mt-4">
            This may take a few moments...
          </p>
        </main>
      )}

      {view === "results" && analysisResults && (
        <main className="container mx-auto px-4 py-12 animate-slide-up">
          <div className="max-w-3xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <h2 className="font-heading text-3xl font-bold text-foreground mb-1">
                  Your Report Explained
                </h2>
                <p className="text-muted-foreground">{selectedFile?.name}</p>
              </div>
              <ModeToggle mode={mode} onModeChange={handleModeChange} />
            </div>

            {/* Report Type Badge */}
            {analysisResults.reportType && analysisResults.reportType !== "unknown" && (
              <div className="mb-6 inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium">
                <FileText className="h-4 w-4" />
                {formatReportType(analysisResults.reportType)}
              </div>
            )}

            {/* ===================== PATIENT MODE CONTENT ===================== */}
            {mode === "patient" && (
              <>
                {/* 1️⃣ What This Test Is About */}
                {analysisResults.whatThisTestIsAbout && (
                  <div className="medical-card p-6 mb-6 bg-primary/5 border-primary/20">
                    <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                      <Heart className="h-5 w-5 text-primary" />
                      What This Test Is About
                    </h3>
                    <p className="text-foreground/80 leading-relaxed text-lg">
                      {analysisResults.whatThisTestIsAbout}
                    </p>
                  </div>
                )}

                {/* 2️⃣ Simple Image Explanation */}
                {analysisResults.simpleImageExplanation && (
                  <div className="medical-card p-6 mb-6">
                    <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                      <Activity className="h-5 w-5 text-primary" />
                      Simple Image Explanation
                    </h3>
                    <p className="text-foreground/80 leading-relaxed">
                      {analysisResults.simpleImageExplanation}
                    </p>
                  </div>
                )}

                {/* 3️⃣ Summary */}
                <div className="medical-card p-6 mb-6">
                  <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-primary" />
                    Summary
                  </h3>
                  <p className="text-foreground/80 leading-relaxed">{analysisResults.summary}</p>
                </div>

                {/* 4️⃣ Possible Risk Factors */}
                {analysisResults.possibleRiskFactors && (
                  <div className="medical-card p-6 mb-6 bg-accent/30">
                    <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                      <ClipboardList className="h-5 w-5 text-primary" />
                      Possible Risk Factors (Educational Only)
                    </h3>
                    <p className="text-foreground/80 leading-relaxed">
                      {analysisResults.possibleRiskFactors}
                    </p>
                  </div>
                )}

                {/* 5️⃣ Why You Should Consult a Doctor */}
                {analysisResults.whyConsultDoctor && (
                  <div className="medical-card p-6 mb-6 bg-blue-500/5 border-blue-500/20">
                    <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                      <UserCheck className="h-5 w-5 text-blue-500" />
                      Why You Should Consult a Doctor
                    </h3>
                    <p className="text-foreground/80 leading-relaxed">
                      {analysisResults.whyConsultDoctor}
                    </p>
                  </div>
                )}

                {/* 6️⃣ Reassurance Message */}
                {analysisResults.reassurance && (
                  <div className="medical-card p-6 mb-6 bg-success/5 border-success/20">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0 mt-0.5" />
                      <p className="text-foreground/80 leading-relaxed font-medium">
                        {analysisResults.reassurance}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ===================== CLINICIAN MODE CONTENT ===================== */}
            {mode === "clinician" && (
              <>
                {/* 1️⃣ Imaging Type & Region */}
                {analysisResults.imagingTypeAndRegion && (
                  <div className="medical-card p-6 mb-6 bg-primary/5 border-primary/20">
                    <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                      <Stethoscope className="h-5 w-5 text-primary" />
                      Imaging Type & Region
                    </h3>
                    <pre className="text-foreground/80 leading-relaxed whitespace-pre-wrap font-sans">
                      {analysisResults.imagingTypeAndRegion}
                    </pre>
                  </div>
                )}

                {/* 2️⃣ Key Observations */}
                {analysisResults.keyObservations && analysisResults.keyObservations.length > 0 && (
                  <div className="medical-card p-6 mb-6">
                    <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                      <ClipboardList className="h-5 w-5 text-primary" />
                      Key Observations
                    </h3>
                    <ul className="space-y-2">
                      {analysisResults.keyObservations.map((obs, index) => (
                        <li key={index} className="text-foreground/80 leading-relaxed">
                          {obs}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 3️⃣ Impression */}
                {analysisResults.impression && (
                  <div className="medical-card p-6 mb-6 bg-accent/30">
                    <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                      <Brain className="h-5 w-5 text-primary" />
                      Impression (Non-diagnostic)
                    </h3>
                    <p className="text-foreground/80 leading-relaxed">
                      {analysisResults.impression}
                    </p>
                  </div>
                )}

                {/* 4️⃣ Recommendation */}
                {analysisResults.recommendation && (
                  <div className="medical-card p-6 mb-6 bg-blue-500/5 border-blue-500/20">
                    <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-blue-500" />
                      Recommendation
                    </h3>
                    <p className="text-foreground/80 leading-relaxed">
                      {analysisResults.recommendation}
                    </p>
                  </div>
                )}
              </>
            )}

            {/* ===================== COMMON SECTIONS ===================== */}
            
            {/* References */}
            {analysisResults.references && analysisResults.references.length > 0 && (
              <div className="medical-card p-6 mb-6">
                <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  Sources Referenced
                </h3>
                <ul className="space-y-2">
                  {analysisResults.references.map((ref, index) => (
                    <li key={index} className="text-sm text-muted-foreground">
                      [{index + 1}] {ref}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 7️⃣ Disclaimer (Required) */}
            <div className="medical-card p-6 mb-8 bg-warning/5 border-warning/20">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground mb-1">Important Notice</p>
                  <p className="text-foreground/80 text-sm leading-relaxed">{analysisResults.disclaimer}</p>
                </div>
              </div>
            </div>

            <DisclaimerBanner variant="warning" className="mb-8" />

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Button variant="hero" size="lg" onClick={handleStartOver} className="flex-1">
                <Upload className="h-5 w-5" />
                Analyze Another Report
              </Button>
            </div>
          </div>
        </main>
      )}

      {/* Footer */}
      <footer className="border-t border-border mt-16 py-8">
        <div className="container mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground mb-4">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">
              Educational use only. Not a medical diagnosis.
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            © 2026 MedReport AI. Always consult a licensed healthcare professional.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
