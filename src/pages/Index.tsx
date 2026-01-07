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
  MessageCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { FileUpload } from "@/components/FileUpload";
import { ModeToggle } from "@/components/ModeToggle";
import { ProcessingLoader } from "@/components/ProcessingLoader";
import { ResultCard } from "@/components/ResultCard";
import { RedFlagAlert } from "@/components/RedFlagAlert";
import { FeatureCard } from "@/components/FeatureCard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type ViewState = "home" | "upload" | "processing" | "results";
type ProcessingStep = "extracting" | "analyzing" | "generating";

interface AnalysisResult {
  summary: string;
  riskLevel: "low" | "moderate" | "high";
  criticalFindings: string[];
  items: Array<{
    name: string;
    value: string;
    unit?: string;
    referenceRange?: string;
    status: "normal" | "abnormal" | "critical";
    explanation: string;
  }>;
  // Patient mode fields
  overallAssessment?: "normal" | "slightly unusual" | "needs professional review";
  questionsToAsk?: string[];
  reassurance?: string;
  // Clinician mode fields
  anatomicalRegions?: string[];
  deviations?: string[];
  imageQuality?: string;
  recommendation?: string;
  // Common
  disclaimer: string;
  rawResponse?: boolean;
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
          // Remove the data:image/xxx;base64, prefix
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

      if (fnError) {
        throw new Error(fnError.message || "Failed to analyze report");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      setProcessingStep("generating");
      
      // Small delay for UX
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setAnalysisResults(data);
      setView("results");
    } catch (err) {
      console.error("Analysis error:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to analyze report";
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

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {view === "home" && (
        <main className="container mx-auto px-4 py-12">
          {/* Hero Section */}
          <section className="text-center max-w-3xl mx-auto mb-16 animate-fade-in">
            <div className="inline-flex items-center gap-2 bg-accent/50 text-accent-foreground px-4 py-2 rounded-full text-sm font-medium mb-6">
              <Shield className="h-4 w-4" />
              Safe, Educational, Non-Diagnostic
            </div>
            <h1 className="font-heading text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
              Understand Your
              <span className="gradient-text"> Medical Reports</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Upload your lab results or radiology reports and get clear, easy-to-understand 
              explanations powered by AI. For education only—always consult your doctor.
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
                description="Simply upload your PDF or image file. We support lab reports, X-rays, MRIs, CT scans, and more."
              />
              <FeatureCard
                icon={Brain}
                title="AI Analysis"
                description="Our medical AI extracts and interprets your results, identifying what each value means."
              />
              <FeatureCard
                icon={MessageCircle}
                title="Clear Explanations"
                description="Get results in plain language or clinical format. Understand what to discuss with your doctor."
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
              Select a PDF or image of your medical report to get started.
            </p>

            <FileUpload onFileSelect={handleFileSelect} />

            <div className="mt-8 space-y-6">
              <div>
                <label className="block text-sm font-medium text-foreground mb-3">
                  Choose Explanation Mode
                </label>
                <ModeToggle mode={mode} onModeChange={setMode} />
                <p className="text-sm text-muted-foreground mt-3">
                  {mode === "patient" 
                    ? "Get explanations in simple, easy-to-understand language."
                    : "Get structured clinical summaries with medical terminology."}
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <h2 className="font-heading text-3xl font-bold text-foreground mb-1">
                  Your Report Explained
                </h2>
                <p className="text-muted-foreground">
                  {selectedFile?.name}
                </p>
              </div>
              <ModeToggle mode={mode} onModeChange={setMode} />
            </div>

            {/* Risk Level Badge */}
            {analysisResults.riskLevel && (
              <div className={`mb-6 p-4 rounded-xl border flex items-center gap-3 ${
                analysisResults.riskLevel === "high" 
                  ? "bg-destructive/10 border-destructive/30" 
                  : analysisResults.riskLevel === "moderate"
                  ? "bg-warning/10 border-warning/30"
                  : "bg-success/10 border-success/30"
              }`}>
                <div className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  analysisResults.riskLevel === "high" 
                    ? "bg-destructive/20 text-destructive" 
                    : analysisResults.riskLevel === "moderate"
                    ? "bg-warning/20 text-warning"
                    : "bg-success/20 text-success"
                }`}>
                  {analysisResults.riskLevel.charAt(0).toUpperCase() + analysisResults.riskLevel.slice(1)} Risk
                </div>
                <span className="text-sm text-muted-foreground">
                  {analysisResults.riskLevel === "high" 
                    ? "Professional consultation recommended"
                    : analysisResults.riskLevel === "moderate"
                    ? "Some findings may need review"
                    : "Findings appear within expected ranges"}
                </span>
              </div>
            )}

            {/* Overall Assessment (Patient Mode) */}
            {mode === "patient" && analysisResults.overallAssessment && (
              <div className={`mb-6 p-4 rounded-xl border ${
                analysisResults.overallAssessment === "needs professional review"
                  ? "bg-warning/10 border-warning/30"
                  : analysisResults.overallAssessment === "slightly unusual"
                  ? "bg-accent/50 border-accent"
                  : "bg-success/10 border-success/30"
              }`}>
                <p className="text-foreground font-medium">
                  Overall Assessment: <span className="capitalize">{analysisResults.overallAssessment}</span>
                </p>
              </div>
            )}

            {/* Critical Findings Alert */}
            {analysisResults.criticalFindings && analysisResults.criticalFindings.length > 0 && (
              <div className="mb-8">
                <RedFlagAlert findings={analysisResults.criticalFindings} />
              </div>
            )}

            {/* Summary */}
            <div className="medical-card p-6 mb-8">
              <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <Stethoscope className="h-5 w-5 text-primary" />
                Summary
              </h3>
              <p className="text-foreground/80 leading-relaxed">{analysisResults.summary}</p>
            </div>

            {/* Result Items */}
            {analysisResults.items && analysisResults.items.length > 0 && (
              <div className="space-y-4 mb-8">
                <h3 className="font-semibold text-foreground">Detailed Results</h3>
                {analysisResults.items.map((item, index) => (
                  <ResultCard key={index} item={item} mode={mode} />
                ))}
              </div>
            )}

            {/* Clinician Mode: Anatomical Regions, Deviations, Recommendation */}
            {mode === "clinician" && (
              <>
                {analysisResults.anatomicalRegions && analysisResults.anatomicalRegions.length > 0 && (
                  <div className="medical-card p-6 mb-8">
                    <h3 className="font-semibold text-foreground mb-3">Anatomical Regions Involved</h3>
                    <ul className="list-disc list-inside text-foreground/80 space-y-1">
                      {analysisResults.anatomicalRegions.map((region, index) => (
                        <li key={index}>{region}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {analysisResults.deviations && analysisResults.deviations.length > 0 && (
                  <div className="medical-card p-6 mb-8">
                    <h3 className="font-semibold text-foreground mb-3">Notable Deviations</h3>
                    <ul className="list-disc list-inside text-foreground/80 space-y-1">
                      {analysisResults.deviations.map((deviation, index) => (
                        <li key={index}>{deviation}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {analysisResults.recommendation && (
                  <div className="medical-card p-6 mb-8 bg-accent/30">
                    <h3 className="font-semibold text-foreground mb-3">Recommendation</h3>
                    <p className="text-foreground/80 leading-relaxed">{analysisResults.recommendation}</p>
                  </div>
                )}
                {analysisResults.imageQuality && (
                  <div className="medical-card p-6 mb-8">
                    <h3 className="font-semibold text-foreground mb-3">Image/Report Quality Notes</h3>
                    <p className="text-muted-foreground">{analysisResults.imageQuality}</p>
                  </div>
                )}
              </>
            )}

            {/* Questions to Ask (Patient Mode) */}
            {mode === "patient" && analysisResults.questionsToAsk && analysisResults.questionsToAsk.length > 0 && (
              <div className="medical-card p-6 mb-8">
                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <MessageCircle className="h-5 w-5 text-primary" />
                  Questions to Ask Your Doctor
                </h3>
                <ul className="space-y-3">
                  {analysisResults.questionsToAsk.map((question, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">
                        {index + 1}
                      </span>
                      <span className="text-foreground/80">{question}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Reassurance (Patient Mode) */}
            {mode === "patient" && analysisResults.reassurance && (
              <div className="medical-card p-6 mb-8 bg-success/5 border-success/20">
                <p className="text-foreground/80 leading-relaxed">{analysisResults.reassurance}</p>
              </div>
            )}

            {/* Disclaimer from AI Response */}
            {analysisResults.disclaimer && (
              <div className="medical-card p-6 mb-8 bg-warning/5 border-warning/20">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
                  <p className="text-foreground/80 text-sm leading-relaxed">{analysisResults.disclaimer}</p>
                </div>
              </div>
            )}

            {/* Standard Disclaimer */}
            <DisclaimerBanner variant="warning" className="mb-8" />

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Button variant="hero" size="lg" onClick={handleStartOver} className="flex-1">
                <Upload className="h-5 w-5" />
                Analyze Another Report
              </Button>
              <Button variant="outline" size="lg" className="flex-1">
                <FileText className="h-5 w-5" />
                Download Summary
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
              This tool is for educational purposes only and does not provide medical advice.
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            © 2026 MedReport AI. Always consult a licensed healthcare professional for medical decisions.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;

