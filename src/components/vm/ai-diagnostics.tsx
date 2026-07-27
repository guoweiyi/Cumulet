"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, BrainCircuit, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Analysis = {
  healthScore: number;
  severity: "healthy" | "warning" | "critical";
  summary: string;
  suggestions: string[];
  findings: { title: string; severity: string; evidence: string; recommendation: string }[];
};

type Inspection = {
  id: string;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  severity: "HEALTHY" | "WARNING" | "CRITICAL" | "UNKNOWN";
  healthScore: number | null;
  analysis: Analysis | null;
  errorMessage: string | null;
  createdAt: string;
};

export function AiDiagnostics({ bindingId }: { bindingId: string }) {
  const t = useTranslations("vm");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/vms/${bindingId}/ai-inspections`, { cache: "no-store" });
    if (response.ok) setInspections((await response.json()).inspections);
    setLoading(false);
  }, [bindingId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run() {
    setRunning(true);
    try {
      const response = await fetch(`/api/vms/${bindingId}/ai-inspections`, { method: "POST" });
      if (response.ok) {
        toast.success(t("aiComplete"));
        await load();
      } else if (response.status === 429) {
        toast.error(tc("rateLimited"));
      } else {
        toast.error(t("aiUnavailable"));
      }
    } finally {
      setRunning(false);
    }
  }

  const latest = inspections[0];
  const severityClass = latest?.severity === "CRITICAL"
    ? "bg-red-50 text-red-700"
    : latest?.severity === "WARNING"
      ? "bg-amber-50 text-amber-700"
      : "bg-emerald-50 text-emerald-700";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-sm text-neutral-500">
          <BrainCircuit className="size-4 text-fuchsia-600" /> {t("aiDiagnostics")}
        </CardTitle>
        <Button size="sm" variant="outline" disabled={running} onClick={run}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <BrainCircuit className="size-4" />}
          {running ? t("aiRunning") : t("aiRun")}
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-neutral-300" />
        ) : !latest ? (
          <p className="py-3 text-center text-xs text-muted-foreground">{t("aiEmpty")}</p>
        ) : latest.status === "FAILED" ? (
          <div className="flex items-start gap-2 text-sm text-red-600">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{t("aiFailed")}</span>
          </div>
        ) : latest.analysis ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="tnum text-3xl font-semibold text-neutral-900">{latest.healthScore}</div>
              <div>
                <Badge variant="secondary" className={severityClass}>
                  {t(`aiSeverity.${latest.severity}`)}
                </Badge>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {new Date(latest.createdAt).toLocaleString(locale)}
                </p>
              </div>
            </div>
            <p className="text-sm leading-6 text-neutral-700">{latest.analysis.summary}</p>
            {latest.analysis.suggestions.length > 0 && (
              <ul className="space-y-1.5 border-t pt-3 text-xs text-neutral-600">
                {latest.analysis.suggestions.map((suggestion, index) => (
                  <li key={`${index}-${suggestion}`} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                    <span>{suggestion}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="py-3 text-center text-xs text-muted-foreground">{t("aiRunning")}</p>
        )}
      </CardContent>
    </Card>
  );
}
