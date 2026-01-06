import { Activity, Shield } from "lucide-react";

export const Header = () => {
  return (
    <header className="w-full border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-medium">
              <Activity className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-heading font-bold text-lg text-foreground">MedReport AI</h1>
              <p className="text-xs text-muted-foreground">Medical Report Explainer</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/50 px-3 py-1.5 rounded-full">
            <Shield className="h-3.5 w-3.5 text-primary" />
            <span>Educational Use Only</span>
          </div>
        </div>
      </div>
    </header>
  );
};
