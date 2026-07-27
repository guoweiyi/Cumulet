"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertCircle, BrainCircuit, Check, CircleDashed, Loader2, MinusCircle, RotateCw, SkipForward } from "lucide-react";
import type { TicketDetailData } from "@/lib/ticket-data";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Vertical provisioning step tracker. Admin write access enables per-step
 * Retry/Skip on failed steps.
 */
export function PipelineTracker({
  ticket,
  canWrite,
  reload,
}: {
  ticket: TicketDetailData;
  canWrite: boolean;
  reload: () => void;
}) {
  const t = useTranslations("pipeline");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [diagnoses, setDiagnoses] = useState<Record<string, { likelyCause: string; confidence: string; checks: string[]; recoveryActions: string[]; safeToRetry: boolean }>>({});
  const binding = ticket.binding;
  if (!binding || binding.steps.length === 0) return null;

  const hasFailure = binding.steps.some((s) => s.status === "FAILED");

  async function act(step: string, action: "retry" | "skip") {
    if (action === "skip" && !confirm(t("skipConfirm"))) return;
    setBusyStep(step);
    try {
      const res = await fetch(`/api/admin/bindings/${binding!.id}/steps/${step}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error?.message ?? tc("requestFailed"));
      } else {
        toast.success(t(action === "skip" ? "skipContinued" : "retryContinued"));
      }
      await reload();
    } finally {
      setBusyStep(null);
    }
  }

  async function diagnose(step: string) {
    setBusyStep(step);
    try {
      const res = await fetch(`/api/admin/bindings/${binding!.id}/ai-diagnose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, locale: locale === "en" ? "en" : "zh" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error(data?.error?.message ?? tc("requestFailed")); return; }
      setDiagnoses((current) => ({ ...current, [step]: data.diagnosis }));
    } finally { setBusyStep(null); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-neutral-500">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {hasFailure && ticket.status === "PROVISIONING" && (
          <Alert className="mb-4 border-red-200 bg-red-50 text-red-700">
            <AlertCircle className="size-4" />
            <AlertDescription className="text-red-700">{t("banner")}</AlertDescription>
          </Alert>
        )}
        <ol className="relative space-y-0">
          {binding.steps.map((s, i) => {
            const last = i === binding.steps.length - 1;
            const duration =
              s.startedAt && s.finishedAt
                ? Math.max(1, Math.round((+new Date(s.finishedAt) - +new Date(s.startedAt)) / 1000))
                : null;
            return (
              <li key={s.step} className="relative flex gap-3 pb-1">
                {!last && (
                  <span className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-neutral-200" />
                )}
                <StepIcon status={s.status} />
                <div className="min-w-0 flex-1 pb-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-sm font-medium",
                        s.status === "FAILED" && "text-red-600",
                        s.status === "SKIPPED" && "text-neutral-400 line-through",
                      )}
                    >
                      {t(`step.${s.step}`)}
                    </span>
                    <span className="text-xs text-neutral-400">{t(`status.${s.status}`)}</span>
                    {duration !== null && s.status === "SUCCESS" && (
                      <span className="text-[10px] text-neutral-300">
                        {t("duration", { seconds: duration })}
                      </span>
                    )}
                    {canWrite && s.status === "FAILED" && (
                      <span className="ml-auto flex gap-1">
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busyStep !== null} onClick={() => diagnose(s.step)}>
                          <BrainCircuit className="size-3" /> {t("aiDiagnose")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={busyStep !== null}
                          onClick={() => act(s.step, "retry")}
                        >
                          {busyStep === s.step ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <RotateCw className="size-3" />
                          )}
                          {t("retryStep")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-neutral-500"
                          disabled={busyStep !== null}
                          onClick={() => act(s.step, "skip")}
                        >
                          <SkipForward className="size-3" /> {t("skipStep")}
                        </Button>
                      </span>
                    )}
                  </div>
                  {s.errorMessage && s.status === "FAILED" && (
                    <p className="mt-1 whitespace-pre-wrap rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">
                      {s.errorMessage}
                    </p>
                  )}
                  {diagnoses[s.step] && (
                    <div className="mt-2 space-y-2 rounded border border-fuchsia-200 bg-fuchsia-50/60 p-3 text-xs">
                      <div className="font-medium text-fuchsia-900">{diagnoses[s.step].likelyCause}</div>
                      <div className="text-fuchsia-700">{t("confidence")}: {t(`confidenceValue.${diagnoses[s.step].confidence}`)} · {t(diagnoses[s.step].safeToRetry ? "safeToRetry" : "reviewBeforeRetry")}</div>
                      <div><div className="font-medium">{t("checks")}</div><ul className="mt-1 list-disc space-y-1 pl-4">{diagnoses[s.step].checks.map((item) => <li key={item}>{item}</li>)}</ul></div>
                      <div><div className="font-medium">{t("recoveryActions")}</div><ul className="mt-1 list-disc space-y-1 pl-4">{diagnoses[s.step].recoveryActions.map((item) => <li key={item}>{item}</li>)}</ul></div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function StepIcon({ status }: { status: string }) {
  const cls = "relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full";
  switch (status) {
    case "SUCCESS":
      return (
        <span className={cn(cls, "bg-emerald-100 text-emerald-600")}>
          <Check className="size-3.5" />
        </span>
      );
    case "RUNNING":
      return (
        <span className={cn(cls, "bg-blue-100 text-blue-600")}>
          <Loader2 className="size-3.5 animate-spin" />
        </span>
      );
    case "FAILED":
      return (
        <span className={cn(cls, "bg-red-100 text-red-600")}>
          <AlertCircle className="size-3.5" />
        </span>
      );
    case "SKIPPED":
      return (
        <span className={cn(cls, "bg-neutral-100 text-neutral-400")}>
          <MinusCircle className="size-3.5" />
        </span>
      );
    default:
      return (
        <span className={cn(cls, "bg-neutral-100 text-neutral-300")}>
          <CircleDashed className="size-3.5" />
        </span>
      );
  }
}
