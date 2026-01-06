import { Loader2, FileSearch, Brain, ClipboardCheck } from "lucide-react";

interface ProcessingLoaderProps {
  step: "extracting" | "analyzing" | "generating";
}

export const ProcessingLoader = ({ step }: ProcessingLoaderProps) => {
  const steps = [
    { key: "extracting", icon: FileSearch, label: "Extracting text from report" },
    { key: "analyzing", icon: Brain, label: "Analyzing medical content" },
    { key: "generating", icon: ClipboardCheck, label: "Generating explanation" },
  ];

  const currentIndex = steps.findIndex((s) => s.key === step);

  return (
    <div className="w-full max-w-md mx-auto py-12">
      <div className="flex items-center justify-center mb-8">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
        </div>
      </div>
      
      <div className="space-y-4">
        {steps.map((s, index) => {
          const Icon = s.icon;
          const isActive = index === currentIndex;
          const isDone = index < currentIndex;
          
          return (
            <div
              key={s.key}
              className={`flex items-center gap-4 p-4 rounded-xl transition-all duration-300 ${
                isActive
                  ? "bg-primary/10 border border-primary/30"
                  : isDone
                  ? "bg-success/10 border border-success/30"
                  : "bg-secondary/50 border border-transparent"
              }`}
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isDone
                    ? "bg-success text-success-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {isActive ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Icon className="h-5 w-5" />
                )}
              </div>
              <span
                className={`font-medium ${
                  isActive
                    ? "text-primary"
                    : isDone
                    ? "text-success"
                    : "text-muted-foreground"
                }`}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
