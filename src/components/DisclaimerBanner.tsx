import { AlertTriangle, Info } from "lucide-react";

interface DisclaimerBannerProps {
  variant?: "info" | "warning";
  className?: string;
}

export const DisclaimerBanner = ({ variant = "info", className = "" }: DisclaimerBannerProps) => {
  if (variant === "warning") {
    return (
      <div className={`warning-banner flex items-start gap-3 ${className}`}>
        <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-sm">Important Medical Disclaimer</p>
          <p className="text-sm mt-1 opacity-90">
            This tool does not provide medical diagnosis, treatment advice, or medical opinions. 
            It is for educational and informational purposes only. Always consult a licensed 
            healthcare professional for medical decisions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-accent/50 border border-accent rounded-lg p-4 flex items-start gap-3 ${className}`}>
      <Info className="h-5 w-5 flex-shrink-0 mt-0.5 text-primary" />
      <div className="text-sm text-foreground/80">
        <p className="font-medium text-foreground">Educational Tool Only</p>
        <p className="mt-1">
          This explanation is AI-generated and intended to help you understand your report. 
          It should not replace professional medical advice.
        </p>
      </div>
    </div>
  );
};
