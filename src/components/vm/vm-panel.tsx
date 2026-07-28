"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Copy,
  ExternalLink,
  HardDrive,
  Loader2,
  Monitor,
  Power,
  PowerOff,
  RotateCw,
  Square,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RingGauge } from "./ring-gauge";
import { MetricsCharts } from "./metrics-charts";
import { ResizeDialog } from "./resize-dialog";
import { PasswordResetDialog } from "./password-dialog";
import { FirewallTab } from "@/components/firewall/firewall-tab";
import { VmLogs } from "./vm-logs";
import { AiDiagnostics } from "./ai-diagnostics";

export type VmBindingInfo = {
  id: string;
  vmid: number;
  internalIp: string;
  ciUser: string;
  nodeName: string;
  ticketStatus: string;
  jsAssetId: string | null;
};

export type VmStatusPayload = {
  status: {
    state: string;
    uptime: number;
    cpu: number;
    cpus: number;
    mem: number;
    maxmem: number;
    netin: number;
    netout: number;
    name: string | null;
  };
  config: { cores: number; memoryMb: number; diskGb: number; diskKey: string | null; ciUser: string };
  firewallEnabled: boolean;
  quota: { maxCpuCores: number; maxRamGB: number; maxDiskGB: number; maxFirewallRules: number };
  resizeRequest: {
    id: string;
    status: "PENDING" | "APPLYING";
    requestedCpuCores: number;
    requestedRamGB: number;
    requestedDiskGB: number;
    createdAt: string;
  } | null;
};

export function VmPanel({
  binding,
  jsPortalUrl,
}: {
  binding: VmBindingInfo;
  jsPortalUrl: string | null;
}) {
  const t = useTranslations("vm");
  const tq = useTranslations("quota");
  const tc = useTranslations("common");
  const [data, setData] = useState<VmStatusPayload | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [powerBusy, setPowerBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/vms/${binding.id}/status`, { cache: "no-store" });
      if (res.ok) {
        setData(await res.json());
        setUnreachable(false);
      } else if (res.status === 502) {
        setUnreachable(true);
      }
    } catch {
      setUnreachable(true);
    }
  }, [binding.id]);

  useEffect(() => {
    void load();
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    return () => clearInterval(iv);
  }, [load]);

  async function power(action: "start" | "shutdown" | "reboot" | "stop") {
    const label = t(action === "stop" ? "forceStop" : action);
    const warning = action === "stop" ? `\n${t("forceStopWarning")}` : "";
    if (!confirm(t("powerConfirm", { action: label }) + warning)) return;
    setPowerBusy(true);
    try {
      const res = await fetch(`/api/vms/${binding.id}/power`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        toast.success(t("actionSubmitted"));
        setTimeout(load, 1500);
      } else if (res.status === 429) {
        toast.error(tc("rateLimited"));
      } else {
        toast.error(tc("requestFailed"));
      }
    } finally {
      setPowerBusy(false);
    }
  }

  function openConsole() {
    window.open(`/servers/${binding.id}/console`, "_blank", "width=1080,height=760");
  }

  const running = data?.status.state === "running";
  const stateKey =
    data?.status.state === "running" || data?.status.state === "stopped" || data?.status.state === "paused"
      ? data.status.state
      : "unknown";

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold">
          {data?.status.name || `VM ${binding.vmid}`}
        </h1>
        <Badge
          variant="secondary"
          className={
            running
              ? "bg-emerald-50 text-emerald-700"
              : unreachable
                ? "bg-neutral-100 text-neutral-500"
                : "bg-red-50 text-red-600"
          }
        >
          {unreachable ? tc("connectionFailed") : data ? t(`state.${stateKey}`) : tc("loading")}
        </Badge>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={openConsole}>
          <Monitor className="size-4" /> {t("console")}
        </Button>
        <Button
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700"
          disabled={powerBusy || running}
          onClick={() => power("start")}
        >
          <Power className="size-4" /> {t("start")}
        </Button>
        <Button
          size="sm"
          className="bg-cyan-600 hover:bg-cyan-700"
          disabled={powerBusy || !running}
          onClick={() => power("reboot")}
        >
          <RotateCw className="size-4" /> {t("reboot")}
        </Button>
        <Button
          size="sm"
          className="bg-red-600 hover:bg-red-700"
          disabled={powerBusy || !running}
          onClick={() => power("shutdown")}
        >
          <PowerOff className="size-4" /> {t("shutdown")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-red-200 text-red-600 hover:bg-red-50"
          disabled={powerBusy || !running}
          onClick={() => power("stop")}
        >
          <Square className="size-4" /> {t("forceStop")}
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
          <TabsTrigger value="firewall">{t("tabs.firewall")}</TabsTrigger>
          <TabsTrigger value="logs">{t("tabs.logs")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            {/* Left column: info cards */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm text-neutral-500">{t("serverInfo")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                    <InfoRow label={t("serverName")} value={data?.status.name || `VM ${binding.vmid}`} />
                    <InfoRow label={t("az")} value={binding.nodeName} />
                    <InfoRow label={t("internalIp")} value={binding.internalIp} copyable />
                    <InfoRow label={t("osUser")} value={binding.ciUser} copyable />
                    <InfoRow
                      label={t("uptime")}
                      value={data && running ? formatUptime(data.status.uptime) : "—"}
                    />
                    <InfoRow label="VMID" value={String(binding.vmid)} />
                  </dl>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm text-neutral-500">{t("remoteConnection")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-lg border bg-neutral-50/60 p-3">
                    <p className="mb-1 text-sm font-medium">{t("jumpserverCard")}</p>
                    <p className="mb-2 text-xs text-neutral-500">{t("jumpserverHint")}</p>
                    {jsPortalUrl && (
                      <div className="mb-1.5 flex items-center gap-2 text-xs">
                        <span className="text-neutral-500">{t("jumpserverPortal")}:</span>
                        <code className="rounded bg-white px-1.5 py-0.5">{jsPortalUrl}</code>
                        <CopyBtn text={jsPortalUrl} />
                        <a href={jsPortalUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-3.5 text-blue-600" />
                        </a>
                      </div>
                    )}
                    <div className="mb-2 flex items-center gap-2 text-xs">
                      <span className="text-neutral-500">{t("jumpserverAsset")}:</span>
                      <code className="rounded bg-white px-1.5 py-0.5">cumulet-{binding.vmid}</code>
                      <CopyBtn text={`cumulet-${binding.vmid}`} />
                    </div>
                    <p className="text-[11px] leading-relaxed text-neutral-400">{t("jumpserverHowto")}</p>
                  </div>
                  <PasswordResetDialog bindingId={binding.id} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="text-sm text-neutral-500">{t("configuration")}</CardTitle>
                  {data && !data.resizeRequest && (
                    <ResizeDialog
                      bindingId={binding.id}
                      current={{ cores: data.config.cores, ramMb: data.config.memoryMb, diskGb: data.config.diskGb }}
                      quota={data.quota}
                      onDone={load}
                    />
                  )}
                  {data?.resizeRequest && (
                    <Badge variant="secondary" className="bg-amber-50 text-amber-700">
                      {t("resizePending")}
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {data ? (
                    <>
                      {data.resizeRequest && (
                        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          {t("resizePendingDetail", {
                            cpu: data.resizeRequest.requestedCpuCores,
                            ram: data.resizeRequest.requestedRamGB,
                            disk: data.resizeRequest.requestedDiskGB,
                          })}
                        </p>
                      )}
                      <QuotaBar
                        icon={<HardDrive className="size-3.5" />}
                        label={`${t("cpu")} ${data.config.cores} ${t("cores")}`}
                        pct={(data.config.cores / data.quota.maxCpuCores) * 100}
                        hint={tq("used", { used: data.config.cores, max: data.quota.maxCpuCores })}
                      />
                      <QuotaBar
                        label={`${t("ram")} ${fmtMb(data.config.memoryMb)}`}
                        pct={(data.config.memoryMb / (data.quota.maxRamGB * 1024)) * 100}
                        hint={tq("used", { used: fmtMb(data.config.memoryMb), max: `${data.quota.maxRamGB} GB` })}
                      />
                      <QuotaBar
                        label={`${t("disk")} ${data.config.diskGb} GB`}
                        pct={(data.config.diskGb / data.quota.maxDiskGB) * 100}
                        hint={tq("used", { used: `${data.config.diskGb} GB`, max: `${data.quota.maxDiskGB} GB` })}
                      />
                    </>
                  ) : (
                    <Loader2 className="mx-auto size-5 animate-spin text-neutral-300" />
                  )}
                </CardContent>
              </Card>

              <AiDiagnostics bindingId={binding.id} />
            </div>

            {/* Right column: monitoring */}
            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="text-sm text-neutral-500">{t("monitoring")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex justify-around">
                  <RingGauge
                    value={data?.status.cpu ?? 0}
                    label={t("cpuUsage")}
                    sublabel={data ? `${data.status.cpus} vCPU` : undefined}
                  />
                  <RingGauge
                    value={data && data.status.maxmem > 0 ? data.status.mem / data.status.maxmem : 0}
                    label={t("ramUsage")}
                    sublabel={data ? `${fmtBytes(data.status.mem)} / ${fmtBytes(data.status.maxmem)}` : undefined}
                    color="#7c3aed"
                  />
                </div>
                <MetricsCharts bindingId={binding.id} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="firewall">
          <FirewallTab bindingId={binding.id} />
        </TabsContent>

        <TabsContent value="logs">
          <VmLogs bindingId={binding.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-dashed pb-1.5">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="flex items-center gap-1.5 font-medium">
        {value}
        {copyable && <CopyBtn text={value} />}
      </dd>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const tc = useTranslations("common");
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        toast.success(tc("copied"));
      }}
      className="text-neutral-400 hover:text-blue-600"
    >
      <Copy className="size-3.5" />
    </button>
  );
}

function QuotaBar({
  icon,
  label,
  pct,
  hint,
}: {
  icon?: React.ReactNode;
  label: string;
  pct: number;
  hint: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 font-medium text-neutral-600">
          {icon}
          {label}
        </span>
        <span className="text-neutral-400">{hint}</span>
      </div>
      <Progress value={Math.min(100, pct)} className="h-1.5" />
    </div>
  );
}

function fmtMb(mb: number): string {
  return mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${mb} MB`;
}

function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${Math.round((b / 1024 ** 3) * 10) / 10} GB`;
  return `${Math.round(b / 1024 ** 2)} MB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
