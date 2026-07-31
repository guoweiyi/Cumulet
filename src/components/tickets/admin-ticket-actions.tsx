"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Eye, EyeOff, Loader2, RefreshCw, ShieldAlert, Trash2, XCircle } from "lucide-react";
import { localized, type I18nText } from "@/i18n/config";
import type { TicketDetailData } from "@/lib/ticket-data";
import type { ApprovalField, StepConfig } from "@/lib/workflow-definition";
import type { Field } from "@/lib/form-engine/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

type ProvisionOptions = {
  nodes: { id: string; name: string; nodeName: string; verified: boolean }[];
  securityGroups: { id: string; name: string; description: I18nText | null; isProvisioningDefault: boolean }[];
  gateways: {
    id: string;
    name: string;
    tenantId: string | null;
    publicHost: string;
    mode: "FRP_HTTP_API" | "FRPC_CONFIG";
  }[];
  dnsZones: {
    id: string;
    domain: string;
    tenantId: string;
    mode: "CONFIG_EXPORT" | "HTTP_API";
  }[];
  defaultCiUser: string;
  defaultLeaseDurationDays: number;
  workflow: {
    id: string;
    version: number;
    name: I18nText;
    resourceType: string;
    steps: string[];
    approvalFields: ApprovalField[];
    stepConfigs: Record<string, StepConfig>;
  } | null;
};

function generateInitialPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

/** Parse the raw `over_quota` payload (JSON) into the dimensions that exceed quota. */
function quotaBreakdown(
  raw: string,
): { kind: "cpu" | "ram" | "disk"; value: number; max: number }[] | null {
  try {
    const { quota, usage } = JSON.parse(raw) as {
      quota?: Record<string, number>;
      usage?: Record<string, number>;
    };
    const parts: { kind: "cpu" | "ram" | "disk"; value: number; max: number }[] = [];
    if ((usage?.cpuCores ?? 0) > (quota?.maxCpuCores ?? Infinity)) {
      parts.push({ kind: "cpu", value: usage?.cpuCores ?? 0, max: quota?.maxCpuCores ?? 0 });
    }
    if ((usage?.ramGB ?? 0) > (quota?.maxRamGB ?? Infinity)) {
      parts.push({ kind: "ram", value: usage?.ramGB ?? 0, max: quota?.maxRamGB ?? 0 });
    }
    if ((usage?.diskGB ?? 0) > (quota?.maxDiskGB ?? Infinity)) {
      parts.push({ kind: "disk", value: usage?.diskGB ?? 0, max: quota?.maxDiskGB ?? 0 });
    }
    return parts;
  } catch {
    return null;
  }
}

/** Approve & Provision / Reject / Close / Deprovision buttons + dialogs. */
export function AdminTicketActions({
  ticket,
  reload,
}: {
  ticket: TicketDetailData;
  reload: () => void;
}) {
  const t = useTranslations("admin.ticket");
  const tw = useTranslations("admin.workflow");
  const tc = useTranslations("common");
  const locale = useLocale();
  const externalRequested = [ticket.values.external_access, ticket.values.public_site].some(
    (value) => value === true || value === "true" || value === 1 || value === "1",
  );

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [deprovOpen, setDeprovOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [options, setOptions] = useState<ProvisionOptions | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showWorkflowSecrets, setShowWorkflowSecrets] = useState(false);
  const [workflowInputs, setWorkflowInputs] = useState<Record<string, string | number | boolean>>({});
  const [valuesOverride, setValuesOverride] = useState<Record<string, unknown>>({});
  const [form, setForm] = useState({
    pveNodeId: "",
    vmid: "",
    internalIp: "",
    ciUser: "ubuntu",
    initialPassword: "",
    sshKeys: "",
    nameserver: "",
    ipconfig: "",
    configureSecurityGroup: true,
    securityGroup: "",
    leaseDurationDays: "30",
    externalEnabled: externalRequested,
    gatewayId: "",
    protocol: "HTTPS" as "TCP" | "HTTP" | "HTTPS",
    internalPort: "443",
    externalPort: "",
    hostname: "",
    dnsZoneId: "",
  });
  const [reason, setReason] = useState("");
  const [removeAsset, setRemoveAsset] = useState(false);

  useEffect(() => {
    if (!approveOpen || options) return;
    fetch(`/api/admin/provision-options?ticketId=${encodeURIComponent(ticket.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ProvisionOptions | null) => {
        if (!data) return;
        setOptions(data);
        setValuesOverride(Object.fromEntries(
          (ticket.definition.fields ?? []).map((field) => [
            field.id,
            ticket.values[field.id] ?? field.defaultValue,
          ]),
        ));
        setWorkflowInputs(Object.fromEntries((data.workflow?.approvalFields ?? []).map((field) => [
          field.key,
          field.defaultValue ?? (field.type === "boolean" ? false : field.type === "password" ? generateInitialPassword() : ""),
        ])));
        const gateway = data.gateways[0];
        const zone = data.dnsZones[0];
        setForm((f) => ({
          ...f,
          pveNodeId: data.nodes.find((node) => node.verified)?.id ?? "",
          ciUser: data.defaultCiUser || "ubuntu",
          initialPassword: f.initialPassword || generateInitialPassword(),
          securityGroup:
            data.securityGroups.find((g) => g.isProvisioningDefault)?.name ??
            data.securityGroups[0]?.name ??
            "",
          leaseDurationDays: String(data.defaultLeaseDurationDays || 30),
          gatewayId: gateway?.id ?? "",
          dnsZoneId: zone?.id ?? "",
        }));
      });
  }, [approveOpen, options, ticket.id, ticket.definition.fields, ticket.values]);

  async function post(url: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const breakdown =
          data?.error?.code === "over_quota" && typeof data?.error?.message === "string"
            ? quotaBreakdown(data.error.message)
            : null;
        if (breakdown) {
          const detail = breakdown
            .map((item) =>
              item.kind === "cpu"
                ? t("overQuotaCpu", { value: item.value, max: item.max })
                : item.kind === "ram"
                  ? t("overQuotaRam", { value: item.value, max: item.max })
                  : t("overQuotaDisk", { value: item.value, max: item.max }),
            )
            .join("；");
          toast.error(
            breakdown.length
              ? `${t("overQuotaTitle")} ${detail}`
              : t("overQuotaGeneric"),
          );
        } else if (data?.error?.code === "resource_capacity_missing") {
          toast.error(t("resourceCapacityMissing"));
        } else {
          toast.error(data?.error?.message ?? tc("requestFailed"));
        }
        return false;
      }
      reload();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function readIpFromPve() {
    if (!form.pveNodeId || !form.vmid) return;
    const res = await fetch(
      `/api/admin/pve/${form.pveNodeId}/vms/${encodeURIComponent(form.vmid)}/ip`,
    );
    if (res.ok) {
      const data = await res.json();
      if (data.ip) {
        setForm((f) => ({ ...f, internalIp: data.ip, ipconfig: data.ipconfig ?? f.ipconfig }));
        if (data.warning) toast.warning(t(data.warning));
        return;
      }
      if (data.warning) toast.error(t(data.warning));
      return;
    }
    const data = await res.json().catch(() => null);
    toast.error(data?.error?.message ?? tc("requestFailed"));
  }

  const status = ticket.status;
  const availableGateways = options?.gateways ?? [];
  const availableDnsZones = options?.dnsZones ?? [];
  const externalAccessSupported = options?.workflow?.steps.includes("EXTERNAL_ACCESS") ?? false;
  const securityGroupSupported = options?.workflow?.steps.includes("PVE_SECURITY_GROUP") ?? false;
  const externalEnabled = externalAccessSupported && form.externalEnabled;

  if (ticket.isSystemAlert) {
    return status === "CLOSED" ? null : (
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          if (confirm(tc("confirm") + "?")) await post(`/api/admin/tickets/${ticket.id}/close`);
        }}
      >
        <ShieldAlert className="size-4" /> {t("closeAlert")}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {status === "PENDING" && (
        <>
          <Button size="sm" onClick={() => setApproveOpen(true)}>
            <CheckCircle2 className="size-4" /> {t("approve")}
          </Button>
          <Button size="sm" variant="outline" className="text-red-600" onClick={() => setRejectOpen(true)}>
            <XCircle className="size-4" /> {t("reject")}
          </Button>
        </>
      )}
      {["PENDING", "APPROVED", "PROVISIONING", "FAILED"].includes(status) && !ticket.binding && (
        <Button
          size="sm"
          variant="ghost"
          className="text-neutral-500"
          disabled={busy}
          onClick={async () => {
            if (confirm(tc("confirm") + "?")) await post(`/api/admin/tickets/${ticket.id}/close`);
          }}
        >
          {t("close")}
        </Button>
      )}
      {(status === "ACTIVE" || (
        ["APPROVED", "PROVISIONING", "FAILED"].includes(status) && ticket.binding
      )) && (
        <Button size="sm" variant="outline" className="text-red-600" onClick={() => setDeprovOpen(true)}>
          <Trash2 className="size-4" /> {t("deprovision")}
        </Button>
      )}

      {/* Approve & Provision dialog */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("approveTitle")}</DialogTitle>
          </DialogHeader>
          {!options ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-neutral-400" />
            </div>
          ) : (
            <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto px-1 py-1">
              <div className="col-span-2 rounded-md border bg-neutral-50 px-3 py-2 text-sm">
                <span className="text-neutral-500">{t("workflow")}: </span>
                {options.workflow ? (
                  <span className="font-medium">
                    {localized(options.workflow.name, locale)} · v{options.workflow.version} · {options.workflow.resourceType}
                  </span>
                ) : (
                  <span className="font-medium text-red-600">{t("workflowMissing")}</span>
                )}
                {options.workflow && <div className="mt-2 space-y-1 border-t pt-2">{options.workflow.steps.map((step, index) => { const config = options.workflow?.stepConfigs[step]; return <div key={step} className="flex items-start gap-2 text-xs"><span className="w-5 shrink-0 text-neutral-400">{index + 1}.</span><div className="min-w-0 flex-1"><span className="font-medium">{config?.name ? localized(config.name, locale) : tw(`step.${step}` as never)}</span>{config?.description && <span className="ml-2 text-neutral-500">{localized(config.description, locale)}</span>}</div><span className="shrink-0 text-neutral-400">{config?.requests.length ?? 0} HTTP · {config?.timeoutSeconds}s · {config?.failurePolicy === "SKIP" ? tw("failureSkip") : tw("failureStop")}</span></div>; })}</div>}
              </div>
              {(ticket.definition.fields?.length ?? 0) > 0 && (
                <div className="col-span-2 rounded-md border border-blue-100 bg-blue-50/30 px-3 py-2">
                  <Label>{t("requestParameters")}</Label>
                  <p className="mt-0.5 text-xs text-neutral-500">{t("requestParametersHint")}</p>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    {ticket.definition.fields.map((field) => (
                      <Field
                        key={field.id}
                        label={localized(field.label, locale)}
                        hint={field.hint ? localized(field.hint, locale) : undefined}
                      >
                        <RequestValueEditor
                          field={field}
                          value={valuesOverride[field.id]}
                          onChange={(value) =>
                            setValuesOverride((current) => ({ ...current, [field.id]: value }))
                          }
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              )}
              <Field label={t("azNode")}>
                <Select
                  value={form.pveNodeId}
                  onValueChange={(v) => setForm({ ...form, pveNodeId: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.nodes.map((n) => (
                      <SelectItem key={n.id} value={n.id} disabled={!n.verified}>
                        {n.name} ({n.nodeName})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("vmid")} hint={t("vmidHint")}>
                <Input
                  value={form.vmid}
                  inputMode="numeric"
                  onChange={(e) => setForm({ ...form, vmid: e.target.value.replace(/\D/g, "") })}
                />
              </Field>
              <Field label={t("internalIp")}>
                <div className="flex gap-1.5">
                  <Input
                    value={form.internalIp}
                    onChange={(e) => setForm({ ...form, internalIp: e.target.value })}
                    placeholder="10.0.0.0"
                  />
                  <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={readIpFromPve}>
                    {t("readFromPve")}
                  </Button>
                </div>
              </Field>
              <Field label={t("ciUser")}>
                <Input value={form.ciUser} onChange={(e) => setForm({ ...form, ciUser: e.target.value })} />
              </Field>
              <Field label={t("initialPassword")} hint={t("initialPasswordHint")}>
                <div className="flex gap-1.5">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={form.initialPassword}
                    autoComplete="new-password"
                    onChange={(e) => setForm({ ...form, initialPassword: e.target.value })}
                  />
                  <Button type="button" size="icon" variant="outline" onClick={() => setShowPassword((value) => !value)} title={showPassword ? t("hidePassword") : t("showPassword")}>
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                  <Button type="button" size="icon" variant="outline" onClick={() => setForm({ ...form, initialPassword: generateInitialPassword() })} title={t("generatePassword")}>
                    <RefreshCw className="size-4" />
                  </Button>
                </div>
              </Field>
              <div className="col-span-2">
                <Field label={t("ipconfig")} hint={t("ipconfigHint")}>
                  <Input
                    value={form.ipconfig}
                    onChange={(e) => setForm({ ...form, ipconfig: e.target.value })}
                    placeholder="ip=10.1.2.3/24,gw=10.1.2.1"
                  />
                </Field>
              </div>
              <Field label={t("nameserver")}>
                <Input
                  value={form.nameserver}
                  onChange={(e) => setForm({ ...form, nameserver: e.target.value })}
                  placeholder="223.5.5.5"
                />
              </Field>
              {securityGroupSupported && (
                <div className="col-span-2 flex items-center justify-between gap-4 border-t border-neutral-200 pt-3">
                  <div>
                    <Label>{t("configureSecurityGroup")}</Label>
                    <p className="mt-0.5 text-xs text-neutral-500">{t("configureSecurityGroupHint")}</p>
                  </div>
                  <Switch checked={form.configureSecurityGroup} onCheckedChange={(checked) => setForm({ ...form, configureSecurityGroup: checked })} />
                </div>
              )}
              {securityGroupSupported && form.configureSecurityGroup && (
                <Field label={t("securityGroup")}>
                  <Select value={form.securityGroup} onValueChange={(v) => setForm({ ...form, securityGroup: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {options.securityGroups.map((g) => (
                        <SelectItem key={g.id} value={g.name}>
                          {g.name}{g.description ? ` — ${localized(g.description, locale)}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {options.securityGroups.length === 0 && (
                    <p className="text-[10px] text-amber-600">{t("sgMissing")}</p>
                  )}
                </Field>
              )}
              <Field label={t("leaseDurationDays")}>
                <Input
                  value={form.leaseDurationDays}
                  inputMode="numeric"
                  onChange={(e) => setForm({
                    ...form,
                    leaseDurationDays: e.target.value.replace(/\D/g, ""),
                  })}
                />
              </Field>
              <div className="col-span-2">
                <Field label={t("ciSshKeys")}>
                  <Textarea
                    rows={2}
                    value={form.sshKeys}
                    onChange={(e) => setForm({ ...form, sshKeys: e.target.value })}
                    placeholder="ssh-ed25519 AAAA…"
                  />
                </Field>
              </div>
              {(options.workflow?.approvalFields.length ?? 0) > 0 && <div className="col-span-2 border-t pt-3"><div className="mb-3 flex items-center justify-between"><div><Label>{t("workflowVariables")}</Label><p className="text-xs text-neutral-500">{t("workflowVariablesHint")}</p></div>{options.workflow?.approvalFields.some((field) => field.type === "password") && <Button type="button" size="sm" variant="ghost" onClick={() => setShowWorkflowSecrets((value) => !value)}>{showWorkflowSecrets ? <EyeOff className="size-4" /> : <Eye className="size-4" />}{showWorkflowSecrets ? t("hidePassword") : t("showPassword")}</Button>}</div><div className="grid grid-cols-2 gap-3">{options.workflow?.approvalFields.map((field) => <DynamicApprovalField key={field.key} field={field} value={workflowInputs[field.key]} revealSecrets={showWorkflowSecrets} onChange={(value) => setWorkflowInputs((current) => ({ ...current, [field.key]: value }))} />)}</div></div>}
              {externalAccessSupported && <div className="col-span-2 border-t border-neutral-200 pt-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label>{t("externalAccess")}</Label>
                    <p className="mt-0.5 text-xs text-neutral-500">{t("externalAccessHint")}</p>
                  </div>
                  <Switch
                    checked={form.externalEnabled}
                    onCheckedChange={(checked) => setForm({ ...form, externalEnabled: checked })}
                  />
                </div>
                {externalRequested && availableGateways.length === 0 && (
                  <p className="mt-2 text-xs text-amber-600">{t("gatewayMissing")}</p>
                )}
              </div>}
              {externalAccessSupported && form.externalEnabled && (
                <>
                  <Field label={t("reverseProxyGateway")}>
                    <Select
                      value={form.gatewayId}
                      onValueChange={(value) => setForm({ ...form, gatewayId: value })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {availableGateways.map((gateway) => (
                          <SelectItem key={gateway.id} value={gateway.id}>
                            {gateway.name} ({gateway.publicHost})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t("externalProtocol")}>
                    <Select
                      value={form.protocol}
                      onValueChange={(value: "TCP" | "HTTP" | "HTTPS") => setForm({
                        ...form,
                        protocol: value,
                        internalPort: value === "HTTP" ? "80" : value === "HTTPS" ? "443" : form.internalPort,
                      })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TCP">{t("protocolTcp")}</SelectItem>
                        <SelectItem value="HTTP">{t("protocolHttp")}</SelectItem>
                        <SelectItem value="HTTPS">{t("protocolHttps")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t("internalPort")}>
                    <Input
                      value={form.internalPort}
                      inputMode="numeric"
                      onChange={(e) => setForm({ ...form, internalPort: e.target.value.replace(/\D/g, "") })}
                    />
                  </Field>
                  {form.protocol === "TCP" ? (
                    <Field label={t("externalPort")}>
                      <Input
                        value={form.externalPort}
                        inputMode="numeric"
                        onChange={(e) => setForm({ ...form, externalPort: e.target.value.replace(/\D/g, "") })}
                      />
                    </Field>
                  ) : (
                    <Field label={t("externalHostname")}>
                      <Input
                        value={form.hostname}
                        onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                      />
                    </Field>
                  )}
                  {form.protocol !== "TCP" && (
                    <div className="col-span-2">
                      <Field label={t("dnsZone")} hint={t("dnsZoneHint")}>
                        <Select
                          value={form.dnsZoneId || "none"}
                          onValueChange={(value) => setForm({
                            ...form,
                            dnsZoneId: value === "none" ? "" : value,
                          })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t("noDnsZone")}</SelectItem>
                            {availableDnsZones.map((zone) => (
                              <SelectItem key={zone.id} value={zone.id}>{zone.domain}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={
                busy ||
                !options?.workflow ||
                !form.pveNodeId ||
                !form.vmid ||
                !form.internalIp ||
                !/^[a-z_][a-z0-9_-]{0,31}$/.test(form.ciUser) ||
                form.initialPassword.length < 8 ||
                !!options.workflow?.approvalFields.some((field) => field.required && (workflowInputs[field.key] === "" || workflowInputs[field.key] === undefined)) ||
                (securityGroupSupported && form.configureSecurityGroup && !form.securityGroup) ||
                !form.leaseDurationDays ||
                (externalEnabled && (
                  !form.gatewayId ||
                  !form.internalPort ||
                  (form.protocol === "TCP" ? !form.externalPort : !form.hostname)
                ))
              }
              onClick={async () => {
                const externalAccess = externalEnabled
                  ? {
                      gatewayId: form.gatewayId,
                      protocol: form.protocol,
                      internalPort: Number(form.internalPort),
                      externalPort: form.protocol === "TCP" ? Number(form.externalPort) : null,
                      hostname: form.protocol === "TCP" ? null : form.hostname,
                      dnsZoneId: form.dnsZoneId || undefined,
                      ttl: 300,
                    }
                  : undefined;
                if (
                  await post(`/api/admin/tickets/${ticket.id}/approve`, {
                    pveNodeId: form.pveNodeId,
                    vmid: Number(form.vmid),
                    internalIp: form.internalIp,
                    ciUser: form.ciUser,
                    initialPassword: form.initialPassword,
                    sshKeys: form.sshKeys,
                    nameserver: form.nameserver,
                    ipconfig: form.ipconfig,
                    configureSecurityGroup: securityGroupSupported && form.configureSecurityGroup,
                    securityGroup: securityGroupSupported && form.configureSecurityGroup ? form.securityGroup : undefined,
                    leaseDurationDays: Number(form.leaseDurationDays),
                    workflowInputs,
                    valuesOverride,
                    externalAccess,
                  })
                ) {
                  setApproveOpen(false);
                }
              }}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("startProvision")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reject")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{t("rejectReason")}</Label>
            <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !reason.trim()}
              onClick={async () => {
                if (await post(`/api/admin/tickets/${ticket.id}/reject`, { reason })) {
                  setRejectOpen(false);
                }
              }}
            >
              {tc("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deprovision dialog */}
      <Dialog open={deprovOpen} onOpenChange={setDeprovOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deprovisionTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600">{t("deprovisionHint")}</p>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={removeAsset} onCheckedChange={(v) => setRemoveAsset(v === true)} />
            {t("removeJsAsset")}
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeprovOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (
                  await post(`/api/admin/tickets/${ticket.id}/deprovision`, { removeAsset })
                ) {
                  setDeprovOpen(false);
                }
              }}
            >
              {tc("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DynamicApprovalField({ field, value, revealSecrets, onChange }: { field: ApprovalField; value: string | number | boolean | undefined; revealSecrets: boolean; onChange: (value: string | number | boolean) => void }) {
  const locale = useLocale();
  if (field.type === "boolean") return <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"><div><Label>{localized(field.label, locale)}</Label>{field.description && <p className="text-[10px] text-neutral-400">{localized(field.description, locale)}</p>}</div><Switch checked={value === true} onCheckedChange={onChange} /></div>;
  if (field.type === "select") return <Field label={localized(field.label, locale)} hint={field.description ? localized(field.description, locale) : undefined}><Select value={String(value ?? "")} onValueChange={onChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{field.options?.map((option) => <SelectItem key={option.value} value={option.value}>{localized(option.label, locale)}</SelectItem>)}</SelectContent></Select></Field>;
  return <Field label={localized(field.label, locale)} hint={field.description ? localized(field.description, locale) : undefined}><Input type={field.type === "password" && !revealSecrets ? "password" : field.type === "number" ? "number" : "text"} value={String(value ?? "")} autoComplete={field.type === "password" ? "new-password" : undefined} onChange={(event) => onChange(field.type === "number" ? Number(event.target.value) : event.target.value)} /></Field>;
}

/** Type-aware editor for the requester's submitted form values (admin-adjustable). */
function RequestValueEditor({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const locale = useLocale();
  if (field.type === "toggle") {
    return <Switch checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} />;
  }
  if (field.type === "dropdown" || field.type === "radio_card") {
    return (
      <Select value={String(value ?? "")} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(field.props?.options ?? []).map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {localized(option.label, locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (field.type === "stepper" || field.type === "slider") {
    return (
      <Input
        type="number"
        min={field.props?.min}
        max={field.props?.max}
        step={field.props?.step}
        value={String(value ?? "")}
        onChange={(event) =>
          onChange(event.target.value === "" ? "" : Number(event.target.value))
        }
      />
    );
  }
  return <Input value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-neutral-500">{label}</Label>
      {children}
      {hint && <p className="text-[10px] text-neutral-400">{hint}</p>}
    </div>
  );
}
