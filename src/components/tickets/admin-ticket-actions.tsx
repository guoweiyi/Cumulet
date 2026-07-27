"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Loader2, ShieldAlert, Trash2, XCircle } from "lucide-react";
import { localized, type I18nText } from "@/i18n/config";
import type { TicketDetailData } from "@/lib/ticket-data";
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
  subnets: {
    id: string;
    name: string;
    cidr: string;
    network: { name: string; tenantId: string; tenant: { name: string } };
  }[];
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
};

/** Approve & Provision / Reject / Close / Deprovision buttons + dialogs. */
export function AdminTicketActions({
  ticket,
  reload,
}: {
  ticket: TicketDetailData;
  reload: () => void;
}) {
  const t = useTranslations("admin.ticket");
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
  const [form, setForm] = useState({
    pveNodeId: "",
    vmid: "",
    internalIp: "",
    ciUser: "ubuntu",
    sshKeys: "",
    nameserver: "",
    ipconfig: "",
    securityGroup: "",
    leaseDurationDays: "30",
    subnetId: "",
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
    fetch("/api/admin/provision-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ProvisionOptions | null) => {
        if (!data) return;
        setOptions(data);
        const subnet = data.subnets[0];
        const gateway = data.gateways.find(
          (item) => item.tenantId === null || item.tenantId === subnet?.network.tenantId,
        );
        const zone = data.dnsZones.find(
          (item) => item.tenantId === subnet?.network.tenantId,
        );
        setForm((f) => ({
          ...f,
          pveNodeId: data.nodes[0]?.id ?? "",
          ciUser: data.defaultCiUser || "ubuntu",
          securityGroup:
            data.securityGroups.find((g) => g.isProvisioningDefault)?.name ??
            data.securityGroups[0]?.name ??
            "",
          leaseDurationDays: String(data.defaultLeaseDurationDays || 30),
          subnetId: subnet?.id ?? "",
          gatewayId: gateway?.id ?? "",
          dnsZoneId: zone?.id ?? "",
        }));
      });
  }, [approveOpen, options]);

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
        toast.error(data?.error?.message ?? tc("requestFailed"));
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
        return;
      }
    }
    toast.error(tc("requestFailed"));
  }

  const status = ticket.status;
  const selectedSubnet = options?.subnets.find((subnet) => subnet.id === form.subnetId);
  const availableGateways = options?.gateways.filter(
    (gateway) =>
      gateway.tenantId === null || gateway.tenantId === selectedSubnet?.network.tenantId,
  ) ?? [];
  const availableDnsZones = options?.dnsZones.filter(
    (zone) => zone.tenantId === selectedSubnet?.network.tenantId,
  ) ?? [];

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
      {["PENDING", "APPROVED", "PROVISIONING", "FAILED"].includes(status) && (
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
      {status === "ACTIVE" && (
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
              <Field label={t("securityGroup")}>
                <Select
                  value={form.securityGroup}
                  onValueChange={(v) => setForm({ ...form, securityGroup: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.securityGroups.map((g) => (
                      <SelectItem key={g.id} value={g.name}>
                        {g.name}
                        {g.description ? ` — ${localized(g.description, locale)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
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
              <Field label={t("subnet")} hint={t("subnetHint")}>
                <Select
                  value={form.subnetId}
                  onValueChange={(value) => {
                    const subnet = options.subnets.find((item) => item.id === value);
                    const gateway = options.gateways.find(
                      (item) => item.tenantId === null || item.tenantId === subnet?.network.tenantId,
                    );
                    const zone = options.dnsZones.find(
                      (item) => item.tenantId === subnet?.network.tenantId,
                    );
                    setForm({
                      ...form,
                      subnetId: value,
                      gatewayId: gateway?.id ?? "",
                      dnsZoneId: zone?.id ?? "",
                    });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {options.subnets.map((subnet) => (
                      <SelectItem key={subnet.id} value={subnet.id}>
                        {subnet.network.tenant.name} / {subnet.network.name} / {subnet.name} ({subnet.cidr})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              <div className="col-span-2 border-t border-neutral-200 pt-3">
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
              </div>
              {form.externalEnabled && (
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
                !form.pveNodeId ||
                !form.vmid ||
                !form.internalIp ||
                !form.securityGroup ||
                !form.leaseDurationDays ||
                (form.externalEnabled && (
                  !form.subnetId ||
                  !form.gatewayId ||
                  !form.internalPort ||
                  (form.protocol === "TCP" ? !form.externalPort : !form.hostname)
                ))
              }
              onClick={async () => {
                const externalAccess = form.externalEnabled
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
                    sshKeys: form.sshKeys,
                    nameserver: form.nameserver,
                    ipconfig: form.ipconfig,
                    securityGroup: form.securityGroup,
                    leaseDurationDays: Number(form.leaseDurationDays),
                    subnetId: form.subnetId || undefined,
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
