"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BrainCircuit, KeyRound, Loader2, Mail, Plug, Server, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type SettingsData = {
  smtp: Record<string, unknown> | null;
  jumpserver: Record<string, unknown> | null;
  provisioning: Record<string, unknown> | null;
  ai: Record<string, unknown> | null;
  oidc: Record<string, unknown> | null;
  defaultQuota: Record<string, unknown>;
};

export function SettingsManager() {
  const tc = useTranslations("common");
  const [data, setData] = useState<SettingsData | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/settings", { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-neutral-300" />
      </div>
    );
  }

  async function save(section: string, value: unknown): Promise<boolean> {
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, value }),
    });
    if (!res.ok) {
      toast.error(tc("saveFailed"));
      return false;
    }
    toast.success(tc("saveSuccess"));
    void load();
    return true;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <OidcSection data={data.oidc} onSave={(v) => save("oidc", v)} />
      <SmtpSection data={data.smtp} onSave={(v) => save("smtp", v)} />
      <JumpServerSection data={data.jumpserver} onSave={(v) => save("jumpserver", v)} />
      <ProvisioningSection data={data.provisioning} onSave={(v) => save("provisioning", v)} />
      <AiSection data={data.ai} onSave={(v) => save("ai", v)} />
      <QuotaSection data={data.defaultQuota} onSave={(v) => save("defaultQuota", v)} />
    </div>
  );
}

function OidcSection({
  data,
  onSave,
}: {
  data: Record<string, unknown> | null;
  onSave: (value: unknown) => Promise<boolean>;
}) {
  const t = useTranslations("admin.settings");
  const tc = useTranslations("common");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    enabled: (data?.enabled as boolean) ?? false,
    providerName: (data?.providerName as string) ?? "SSO",
    issuer: (data?.issuer as string) ?? "",
    clientId: (data?.clientId as string) ?? "",
    clientSecret: "",
  });

  async function test() {
    if (!(await onSave(form))) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/settings/test-oidc", { method: "POST" });
      if (response.ok) toast.success(tc("connectionOk"));
      else toast.error(tc("connectionFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section icon={<KeyRound className="size-4 text-blue-700" />} title={t("oidc")}>
      <Row label={t("oidcEnabled")}>
        <Switch checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} />
      </Row>
      <Row label={t("oidcProviderName")}>
        <Input value={form.providerName} onChange={(event) => setForm({ ...form, providerName: event.target.value })} />
      </Row>
      <Row label={t("oidcIssuer")}>
        <Input value={form.issuer} placeholder="https://sso.example.com" onChange={(event) => setForm({ ...form, issuer: event.target.value })} />
      </Row>
      <Row label={t("oidcClientId")}>
        <Input value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })} />
      </Row>
      <Row label={t("oidcClientSecret")}>
        <div className="flex items-center gap-2">
          <Input type="password" value={form.clientSecret} placeholder={t("secretKeepHint")} onChange={(event) => setForm({ ...form, clientSecret: event.target.value })} />
          <SecretBadge set={data?.clientSecretSet as boolean} />
        </div>
      </Row>
      <p className="text-xs text-muted-foreground">{t("oidcHint")}</p>
      <div className="flex gap-2">
        <Button onClick={() => onSave(form)}>{tc("save")}</Button>
        <Button variant="outline" disabled={busy || !form.enabled} onClick={test}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
          {tc("testConnection")}
        </Button>
      </div>
    </Section>
  );
}

function AiSection({
  data,
  onSave,
}: {
  data: Record<string, unknown> | null;
  onSave: (value: unknown) => Promise<boolean>;
}) {
  const t = useTranslations("admin.settings");
  const tc = useTranslations("common");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    enabled: (data?.enabled as boolean) ?? false,
    providerName: (data?.providerName as string) ?? "DeepSeek",
    baseUrl: (data?.baseUrl as string) ?? "https://api.deepseek.com/v1",
    apiKey: "",
    model: (data?.model as string) ?? "deepseek-chat",
    scheduleEnabled: (data?.scheduleEnabled as boolean) ?? false,
    scheduleIntervalMinutes: (data?.scheduleIntervalMinutes as number) ?? 360,
    autoCreateAlertTickets: (data?.autoCreateAlertTickets as boolean) ?? true,
    batchSize: (data?.batchSize as number) ?? 20,
  });

  async function test() {
    if (!(await onSave(form))) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/settings/test-ai", { method: "POST" });
      if (response.ok) toast.success(tc("connectionOk"));
      else toast.error(tc("connectionFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section icon={<BrainCircuit className="size-4 text-fuchsia-600" />} title={t("ai")}>
      <Row label={t("aiEnabled")}>
        <Switch checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} />
      </Row>
      <Row label={t("aiProvider")}>
        <Input value={form.providerName} onChange={(event) => setForm({ ...form, providerName: event.target.value })} />
      </Row>
      <Row label={t("aiBaseUrl")}>
        <Input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
      </Row>
      <Row label={t("aiApiKey")}>
        <div className="flex items-center gap-2">
          <Input type="password" value={form.apiKey} placeholder={t("secretKeepHint")} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} />
          <SecretBadge set={data?.apiKeySet as boolean} />
        </div>
      </Row>
      <Row label={t("aiModel")}>
        <Input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
      </Row>
      <Row label={t("aiSchedule")}>
        <Switch checked={form.scheduleEnabled} onCheckedChange={(scheduleEnabled) => setForm({ ...form, scheduleEnabled })} />
      </Row>
      <Row label={t("aiInterval")}>
        <Input type="number" min={5} max={10080} value={form.scheduleIntervalMinutes} onChange={(event) => setForm({ ...form, scheduleIntervalMinutes: Number(event.target.value) })} />
      </Row>
      <Row label={t("aiBatchSize")}>
        <Input type="number" min={1} max={100} value={form.batchSize} onChange={(event) => setForm({ ...form, batchSize: Number(event.target.value) })} />
      </Row>
      <Row label={t("aiAlertTickets")}>
        <Switch checked={form.autoCreateAlertTickets} onCheckedChange={(autoCreateAlertTickets) => setForm({ ...form, autoCreateAlertTickets })} />
      </Row>
      <div className="flex gap-2">
        <Button onClick={() => onSave(form)}>{tc("save")}</Button>
        <Button variant="outline" disabled={busy} onClick={test}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
          {tc("testConnection")}
        </Button>
      </div>
    </Section>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 items-center gap-3">
      <Label className="text-sm text-neutral-600">{label}</Label>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

function SecretBadge({ set }: { set?: boolean }) {
  const t = useTranslations("admin.settings");
  return (
    <Badge variant="secondary" className={set ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"}>
      {set ? t("secretSet") : t("secretUnset")}
    </Badge>
  );
}

// --- SMTP --------------------------------------------------------------------

function SmtpSection({ data, onSave }: { data: Record<string, unknown> | null; onSave: (v: unknown) => Promise<boolean> }) {
  const t = useTranslations("admin.settings");
  const tc = useTranslations("common");
  const [form, setForm] = useState({
    host: (data?.host as string) ?? "",
    port: (data?.port as number) ?? 587,
    secure: (data?.secure as boolean) ?? false,
    user: (data?.user as string) ?? "",
    password: "",
    from: (data?.from as string) ?? "",
  });
  const [busy, setBusy] = useState(false);

  async function test() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/settings/test-smtp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) toast.success(t("testSent"));
      else toast.error(`${tc("connectionFailed")}${d?.message ? `: ${d.message}` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section icon={<Mail className="size-4 text-blue-600" />} title={t("smtp")}>
      <Row label={t("smtpHost")}>
        <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
      </Row>
      <Row label={t("smtpPort")}>
        <Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
      </Row>
      <Row label={t("smtpSecure")}>
        <Switch checked={form.secure} onCheckedChange={(v) => setForm({ ...form, secure: v })} />
      </Row>
      <Row label={t("smtpUser")}>
        <Input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
      </Row>
      <Row label={t("smtpPassword")}>
        <div className="flex items-center gap-2">
          <Input type="password" placeholder={t("secretKeepHint")} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <SecretBadge set={data?.passwordSet as boolean} />
        </div>
      </Row>
      <Row label={t("smtpFrom")}>
        <Input value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
      </Row>
      <div className="flex gap-2">
        <Button onClick={() => onSave(form)}>{tc("save")}</Button>
        <Button variant="outline" disabled={busy} onClick={test}>
          <Plug className="size-4" /> {t("sendTest")}
        </Button>
      </div>
    </Section>
  );
}

// --- JumpServer --------------------------------------------------------------

function JumpServerSection({ data, onSave }: { data: Record<string, unknown> | null; onSave: (v: unknown) => Promise<boolean> }) {
  const t = useTranslations("admin.settings");
  const tc = useTranslations("common");
  const [form, setForm] = useState({
    baseUrl: (data?.baseUrl as string) ?? "",
    orgId: (data?.orgId as string) ?? "",
    authMode: (data?.authMode as string) ?? "private_token",
    privateToken: "",
    accessKeyId: (data?.accessKeyId as string) ?? "",
    accessKeySecret: "",
    defaultAccountUsername: (data?.defaultAccountUsername as string) ?? "",
    autoCreateUsers: (data?.autoCreateUsers as boolean) ?? false,
  });
  const [busy, setBusy] = useState(false);

  async function test() {
    if (!(await onSave(form))) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/settings/test-jumpserver", { method: "POST" });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) toast.success(tc("connectionOk"));
      else toast.error(`${tc("connectionFailed")}${d?.message ? `: ${d.message}` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section icon={<Shield className="size-4 text-violet-600" />} title={t("jumpserver")}>
      <Row label={t("jsBaseUrl")}>
        <Input value={form.baseUrl} placeholder="https://jumpserver.example.com" onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
      </Row>
      <Row label={t("jsOrgId")}>
        <Input value={form.orgId} onChange={(e) => setForm({ ...form, orgId: e.target.value })} />
      </Row>
      <Row label={t("jsAuthMode")}>
        <Select value={form.authMode} onValueChange={(v) => setForm({ ...form, authMode: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="private_token">Private Token</SelectItem>
            <SelectItem value="access_key">Access Key</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      {form.authMode === "private_token" ? (
        <Row label={t("jsPrivateToken")}>
          <div className="flex items-center gap-2">
            <Input type="password" placeholder={t("secretKeepHint")} value={form.privateToken} onChange={(e) => setForm({ ...form, privateToken: e.target.value })} />
            <SecretBadge set={data?.privateTokenSet as boolean} />
          </div>
        </Row>
      ) : (
        <>
          <Row label={t("jsAccessKeyId")}>
            <Input value={form.accessKeyId} onChange={(e) => setForm({ ...form, accessKeyId: e.target.value })} />
          </Row>
          <Row label={t("jsAccessKeySecret")}>
            <div className="flex items-center gap-2">
              <Input type="password" placeholder={t("secretKeepHint")} value={form.accessKeySecret} onChange={(e) => setForm({ ...form, accessKeySecret: e.target.value })} />
              <SecretBadge set={data?.accessKeySecretSet as boolean} />
            </div>
          </Row>
        </>
      )}
      <Row label={t("jsAccount")}>
        <Input value={form.defaultAccountUsername} placeholder="root / @ALL" onChange={(e) => setForm({ ...form, defaultAccountUsername: e.target.value })} />
      </Row>
      <Row label={t("jsAutoCreate")}>
        <Switch checked={form.autoCreateUsers} onCheckedChange={(v) => setForm({ ...form, autoCreateUsers: v })} />
      </Row>
      <div className="flex gap-2">
        <Button onClick={() => onSave(form)}>{tc("save")}</Button>
        <Button variant="outline" disabled={busy} onClick={test}>
          <Plug className="size-4" /> {tc("testConnection")}
        </Button>
      </div>
    </Section>
  );
}

// --- Provisioning defaults ---------------------------------------------------

function ProvisioningSection({ data, onSave }: { data: Record<string, unknown> | null; onSave: (v: unknown) => Promise<boolean> }) {
  const t = useTranslations("admin.settings");
  const tc = useTranslations("common");
  const [form, setForm] = useState({
    defaultSecurityGroup: (data?.defaultSecurityGroup as string) ?? "",
    jumpServerInternalIp: (data?.jumpServerInternalIp as string) ?? "",
  });

  return (
    <Section icon={<Server className="size-4 text-cyan-600" />} title={t("provisioning")}>
      <Row label={t("defaultSg")}>
        <Input value={form.defaultSecurityGroup} onChange={(e) => setForm({ ...form, defaultSecurityGroup: e.target.value })} />
      </Row>
      <Row label={t("jsInternalIp")}>
        <Input value={form.jumpServerInternalIp} placeholder="10.0.0.10" onChange={(e) => setForm({ ...form, jumpServerInternalIp: e.target.value })} />
      </Row>
      <Button onClick={() => onSave(form)}>{tc("save")}</Button>
    </Section>
  );
}

// --- Default quota -----------------------------------------------------------

function QuotaSection({ data, onSave }: { data: Record<string, unknown>; onSave: (v: unknown) => Promise<boolean> }) {
  const t = useTranslations("admin.settings");
  const tq = useTranslations("quota");
  const tc = useTranslations("common");
  const [form, setForm] = useState({
    maxCpuCores: (data.maxCpuCores as number) ?? 4,
    maxRamGB: (data.maxRamGB as number) ?? 8,
    maxDiskGB: (data.maxDiskGB as number) ?? 100,
    maxFirewallRules: (data.maxFirewallRules as number) ?? 20,
  });

  return (
    <Section icon={<Server className="size-4 text-emerald-600" />} title={t("defaultQuota")}>
      <Row label={tq("cpu")}>
        <Input type="number" value={form.maxCpuCores} onChange={(e) => setForm({ ...form, maxCpuCores: Number(e.target.value) })} />
      </Row>
      <Row label={`${tq("ram")} (GB)`}>
        <Input type="number" value={form.maxRamGB} onChange={(e) => setForm({ ...form, maxRamGB: Number(e.target.value) })} />
      </Row>
      <Row label={`${tq("disk")} (GB)`}>
        <Input type="number" value={form.maxDiskGB} onChange={(e) => setForm({ ...form, maxDiskGB: Number(e.target.value) })} />
      </Row>
      <Row label={tq("firewallRules")}>
        <Input type="number" value={form.maxFirewallRules} onChange={(e) => setForm({ ...form, maxFirewallRules: Number(e.target.value) })} />
      </Row>
      <Button onClick={() => onSave(form)}>{tc("save")}</Button>
    </Section>
  );
}
