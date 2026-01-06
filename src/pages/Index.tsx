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

type ViewState = "home" | "upload" | "processing" | "results";
type ProcessingStep = "extracting" | "analyzing" | "generating";

// Mock result data for demonstration
const mockResults = {
  summary: "Your Complete Blood Count (CBC) results show mostly normal values with one parameter requiring attention.",
  criticalFindings: ["Hemoglobin levels are below normal range (10.2 g/dL vs 12-16 g/dL)"],
  items: [
    {
      name: "Hemoglobin",
      value: "10.2",
      unit: "g/dL",
      status: "abnormal" as const,
      explanation: "Your hemoglobin is slightly below the normal range. This protein carries oxygen in your blood. Low levels may cause fatigue or shortness of breath. Your doctor may recommend further testing or dietary changes.",
    },
    {
      name: "White Blood Cells",
      value: "7,500",
      unit: "/μL",
      status: "normal" as const,
      explanation: "Your white blood cell count is within the healthy range. These cells help fight infections and are an important part of your immune system.",
    },
    {
      name: "Platelets",
      value: "250,000",
      unit: "/μL",
      status: "normal" as const,
      explanation: "Your platelet count is normal. Platelets help your blood clot properly when you have a cut or injury.",
    },
    {
      name: "Red Blood Cells",
      value: "4.2",
      unit: "million/μL",
      status: "normal" as const,
      explanation: "Your red blood cell count is within the expected range. These cells carry oxygen throughout your body.",
    },
  ],
  questionsToAsk: [
    "Should I take iron supplements for my low hemoglobin?",
    "What dietary changes might help improve my blood count?",
    "Do I need a follow-up test to monitor my hemoglobin levels?",
  ],
};

const Index = () => {
  const [view, setView] = useState<ViewState>("home");
  const [mode, setMode] = useState<"patient" | "clinician">("patient");
  const [processingStep, setProcessingStep] = useState<ProcessingStep>("extracting");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
  };

  const handleAnalyze = () => {
    if (!selectedFile) return;
    
    setView("processing");
    setProcessingStep("extracting");

    // Simulate processing steps
    setTimeout(() => setProcessingStep("analyzing"), 1500);
    setTimeout(() => setProcessingStep("generating"), 3000);
    setTimeout(() => setView("results"), 4500);
  };

  const handleStartOver = () => {
    setView("home");
    setSelectedFile(null);
    setProcessingStep("extracting");
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

      {view === "results" && (
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

            {/* Critical Findings Alert */}
            {mockResults.criticalFindings.length > 0 && (
              <div className="mb-8">
                <RedFlagAlert findings={mockResults.criticalFindings} />
              </div>
            )}

            {/* Summary */}
            <div className="medical-card p-6 mb-8">
              <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <Stethoscope className="h-5 w-5 text-primary" />
                Summary
              </h3>
              <p className="text-foreground/80 leading-relaxed">{mockResults.summary}</p>
            </div>

            {/* Result Items */}
            <div className="space-y-4 mb-8">
              <h3 className="font-semibold text-foreground">Detailed Results</h3>
              {mockResults.items.map((item, index) => (
                <ResultCard key={index} item={item} mode={mode} />
              ))}
            </div>

            {/* Questions to Ask */}
            {mode === "patient" && (
              <div className="medical-card p-6 mb-8">
                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <MessageCircle className="h-5 w-5 text-primary" />
                  Questions to Ask Your Doctor
                </h3>
                <ul className="space-y-3">
                  {mockResults.questionsToAsk.map((question, index) => (
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

            {/* Disclaimer */}
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
