import { z } from "zod";

export const aiFindingSchema = z.object({
  title: z.string().min(1).max(200),
  severity: z.enum(["healthy", "warning", "critical"]),
  evidence: z.string().max(1000),
  recommendation: z.string().max(1000),
});

export const aiAnalysisSchema = z.object({
  healthScore: z.number().int().min(0).max(100),
  severity: z.enum(["healthy", "warning", "critical"]),
  summary: z.string().min(1).max(2000),
  suggestions: z.array(z.string().min(1).max(1000)).max(10),
  findings: z.array(aiFindingSchema).max(20),
});

export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;

export const provisioningDiagnosisSchema = z.object({
  likelyCause: z.string().min(1).max(1500),
  confidence: z.enum(["low", "medium", "high"]),
  checks: z.array(z.string().min(1).max(500)).min(1).max(8),
  recoveryActions: z.array(z.string().min(1).max(500)).min(1).max(8),
  safeToRetry: z.boolean(),
});
export type ProvisioningDiagnosis = z.infer<typeof provisioningDiagnosisSchema>;

export function parseProvisioningDiagnosis(content: string): ProvisioningDiagnosis {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  return provisioningDiagnosisSchema.parse(JSON.parse((fenced ?? trimmed).trim()));
}

export type MetricSummary = {
  sampleCount: number;
  cpu: { average: number | null; peak: number | null };
  memory: { averageRatio: number | null; peakRatio: number | null };
  diskReadPeak: number | null;
  diskWritePeak: number | null;
  networkInPeak: number | null;
  networkOutPeak: number | null;
};

export function selectVmLogLines(lines: { t?: string }[], vmid: number): string[] {
  const patterns = [
    new RegExp(`\\bVM\\s+${vmid}\\b`, "i"),
    new RegExp(`\\bvmid(?:=|:|\\s)+${vmid}\\b`, "i"),
    new RegExp(`\\bqemu(?:-server)?(?:/|:|\\s)+${vmid}\\b`, "i"),
    new RegExp(`\\b${vmid}\\.conf\\b`, "i"),
  ];
  return lines
    .map((line) =>
      typeof line.t === "string"
        ? line.t.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500)
        : "",
    )
    .filter((line) => line.length > 0 && patterns.some((pattern) => pattern.test(line)))
    .slice(-80);
}

export function selectScheduledBatch<
  T extends { boundAt: Date; aiInspections: { createdAt: Date }[] },
>(candidates: T[], limit: number): T[] {
  return [...candidates]
    .sort((a, b) => {
      const aLast = a.aiInspections[0]?.createdAt.getTime() ?? 0;
      const bLast = b.aiInspections[0]?.createdAt.getTime() ?? 0;
      return aLast - bLast || a.boundAt.getTime() - b.boundAt.getTime();
    })
    .slice(0, Math.max(0, limit));
}

function finite(values: unknown[]): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function peak(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

export function summarizeMetrics(points: Record<string, number>[]): MetricSummary {
  const bounded = points.slice(-600);
  const cpu = finite(bounded.map((point) => point.cpu));
  const memory = finite(
    bounded.map((point) =>
      typeof point.mem === "number" && typeof point.maxmem === "number" && point.maxmem > 0
        ? point.mem / point.maxmem
        : Number.NaN,
    ),
  );
  return {
    sampleCount: bounded.length,
    cpu: { average: average(cpu), peak: peak(cpu) },
    memory: { averageRatio: average(memory), peakRatio: peak(memory) },
    diskReadPeak: peak(finite(bounded.map((point) => point.diskread))),
    diskWritePeak: peak(finite(bounded.map((point) => point.diskwrite))),
    networkInPeak: peak(finite(bounded.map((point) => point.netin))),
    networkOutPeak: peak(finite(bounded.map((point) => point.netout))),
  };
}

/** Accept plain JSON or a fenced JSON block while rejecting all other text. */
export function parseAiAnalysis(content: string): AiAnalysis {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const candidate = (fenced ?? trimmed).trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) {
    throw new Error("ai_invalid_json");
  }
  return aiAnalysisSchema.parse(JSON.parse(candidate));
}
