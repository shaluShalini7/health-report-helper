import { CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";

interface ResultItem {
  name: string;
  value: string;
  unit?: string;
  status?: "normal" | "abnormal" | "critical";
  explanation: string;
}

interface ResultCardProps {
  item: ResultItem;
  mode: "patient" | "clinician";
}

export const ResultCard = ({ item, mode }: ResultCardProps) => {
  const statusConfig = {
    normal: {
      icon: CheckCircle2,
      bgColor: "bg-success/10",
      borderColor: "border-success/30",
      textColor: "text-success",
      label: "Normal",
    },
    abnormal: {
      icon: AlertCircle,
      bgColor: "bg-warning/10",
      borderColor: "border-warning/30",
      textColor: "text-warning",
      label: "Abnormal",
    },
    critical: {
      icon: AlertTriangle,
      bgColor: "bg-destructive/10",
      borderColor: "border-destructive/30",
      textColor: "text-destructive",
      label: "Critical",
    },
  };

  const config = statusConfig[item.status] || statusConfig.normal;
  const Icon = config.icon;

  return (
    <div className={`medical-card p-5 border ${config.borderColor} ${config.bgColor}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-semibold text-foreground">{item.name}</h4>
          <p className="text-xl font-bold text-foreground mt-1">
            {item.value} {item.unit && <span className="text-sm font-normal text-muted-foreground">{item.unit}</span>}
          </p>
        </div>
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full ${config.bgColor}`}>
          <Icon className={`h-4 w-4 ${config.textColor}`} />
          <span className={`text-xs font-medium ${config.textColor}`}>{config.label}</span>
        </div>
      </div>
      <p className={`text-sm ${mode === "patient" ? "text-foreground/80" : "text-muted-foreground"}`}>
        {item.explanation}
      </p>
    </div>
  );
};
