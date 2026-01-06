import { AlertOctagon, Phone } from "lucide-react";

interface RedFlagAlertProps {
  findings: string[];
}

export const RedFlagAlert = ({ findings }: RedFlagAlertProps) => {
  if (findings.length === 0) return null;

  return (
    <div className="bg-destructive/10 border-2 border-destructive rounded-xl p-5 animate-pulse-soft">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-destructive flex items-center justify-center">
          <AlertOctagon className="h-6 w-6 text-destructive-foreground" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-lg text-destructive mb-2">
            Critical Findings Detected
          </h3>
          <p className="text-sm text-destructive/90 mb-3">
            The following values require immediate medical attention:
          </p>
          <ul className="space-y-1.5 mb-4">
            {findings.map((finding, index) => (
              <li key={index} className="text-sm font-medium text-destructive flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
                {finding}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <Phone className="h-4 w-4" />
            Please contact your healthcare provider immediately
          </div>
        </div>
      </div>
    </div>
  );
};
