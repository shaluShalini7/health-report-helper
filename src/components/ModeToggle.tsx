import { User, Stethoscope } from "lucide-react";

interface ModeToggleProps {
  mode: "patient" | "clinician";
  onModeChange: (mode: "patient" | "clinician") => void;
}

export const ModeToggle = ({ mode, onModeChange }: ModeToggleProps) => {
  return (
    <div className="inline-flex items-center bg-secondary rounded-xl p-1.5 shadow-soft">
      <button
        onClick={() => onModeChange("patient")}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
          mode === "patient"
            ? "bg-primary text-primary-foreground shadow-medium"
            : "text-muted-foreground hover:text-foreground hover:bg-background/50"
        }`}
      >
        <User className="h-4 w-4" />
        Patient Mode
      </button>
      <button
        onClick={() => onModeChange("clinician")}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
          mode === "clinician"
            ? "bg-primary text-primary-foreground shadow-medium"
            : "text-muted-foreground hover:text-foreground hover:bg-background/50"
        }`}
      >
        <Stethoscope className="h-4 w-4" />
        Clinician Mode
      </button>
    </div>
  );
};
