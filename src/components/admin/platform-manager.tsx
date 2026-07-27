"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2, Plus, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Tenant = {
  id: string;
  slug: string;
  name: string;
  _count: { memberships: number; networks: number };
};
type Network = {
  id: string;
  tenantId: string;
  name: string;
  routingDomain: string;
  status: string;
  tenant: { id: string; name: string; slug: string };
  subnets: { id: string; name: string; cidr: string; status: string }[];
};
type Gateway = {
  id: string;
  tenantId: string | null;
  name: string;
  mode: string;
  publicHost: string;
  enabled: boolean;
  secretSet: boolean;
};
type DnsZone = {
  id: string;
  tenantId: string;
  domain: string;
  mode: string;
  secretSet: boolean;
  records: { id: string; status: string }[];
};
type Provider = {
  id: string;
  name: string;
  type: string;
  status: string;
  secretSet: boolean;
  _count: { resources: number };
};
type Webhook = {
  id: string;
  name: string;
  url: string;
  tenantId: string | null;
  enabled: boolean;
  events: string[];
  signingSecretSet: boolean;
  _count: { deliveries: number };
};
type Mapping = {
  id: string;
  protocol: string;
  internalHost: string;
  internalPort: number;
  externalPort: number | null;
  hostname: string | null;
  status: string;
  gateway: { name: string; publicHost: string };
};
type UserOption = { id: string; email: string; realName: string | null };
type Member = { userId: string; role: string; user: UserOption & { nickname: string | null } };

type PlatformData = {
  tenants: Tenant[];
  networks: Network[];
  gateways: Gateway[];
  dnsZones: DnsZone[];
  providers: Provider[];
  webhooks: Webhook[];
  mappings: Mapping[];
  users: UserOption[];
};

const WEBHOOK_EVENTS = [
  "TICKET_STATUS_CHANGED",
  "RESOURCE_PROVISIONED",
  "RESOURCE_EXPIRED",
  "RESOURCE_PENDING_DELETION",
] as const;

export function PlatformManager({ canWrite }: { canWrite: boolean }) {
  const t = useTranslations("admin.platform");
  const tc = useTranslations("common");
  const [data, setData] = useState<PlatformData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedTenant, setSelectedTenant] = useState("");
  const [members, setMembers] = useState<Member[]>([]);

  const load = useCallback(async () => {
    const paths = [
      "/api/admin/tenants",
      "/api/admin/networks",
      "/api/admin/reverse-proxy-gateways",
      "/api/admin/dns-zones",
      "/api/admin/providers",
      "/api/admin/webhooks",
      "/api/admin/external-access",
      "/api/admin/users",
    ] as const;
    const responses = await Promise.all(paths.map((path) => fetch(path)));
    if (responses.some((response) => !response.ok)) {
      toast.error(tc("requestFailed"));
      return;
    }
    const [tenants, networks, gateways, zones, providers, webhooks, mappings, users] =
      await Promise.all(responses.map((response) => response.json()));
    const next: PlatformData = {
      tenants: tenants.tenants,
      networks: networks.networks,
      gateways: gateways.gateways,
      dnsZones: zones.zones,
      providers: providers.providers,
      webhooks: webhooks.endpoints,
      mappings: mappings.mappings,
      users: users.users,
    };
    setData(next);
    setSelectedTenant((current) => current || next.tenants[0]?.id || "");
  }, [tc]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selectedTenant) {
      setMembers([]);
      return;
    }
    void fetch(`/api/admin/tenants/${selectedTenant}/members`)
      .then((response) => response.ok ? response.json() : { members: [] })
      .then((result) => setMembers(result.members));
  }, [selectedTenant]);

  async function mutate(key: string, path: string, method: string, body?: unknown) {
    setBusy(key);
    try {
      const response = await fetch(path, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        toast.error(result?.error?.message ?? tc("requestFailed"));
        return false;
      }
      toast.success(t("saved"));
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return <div className="flex h-48 items-center justify-center"><Loader2 className="size-5 animate-spin text-neutral-400" /></div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <Tabs defaultValue="tenants">
        <TabsList>
          <TabsTrigger value="tenants">{t("tabs.tenants")}</TabsTrigger>
          <TabsTrigger value="access">{t("tabs.access")}</TabsTrigger>
          <TabsTrigger value="providers">{t("tabs.providers")}</TabsTrigger>
          <TabsTrigger value="webhooks">{t("tabs.webhooks")}</TabsTrigger>
        </TabsList>
        <TabsContent value="tenants" className="mt-4">
          <TenantNetworkTab
            data={data}
            members={members}
            selectedTenant={selectedTenant}
            setSelectedTenant={setSelectedTenant}
            canWrite={canWrite}
            busy={busy}
            mutate={mutate}
          />
        </TabsContent>
        <TabsContent value="access" className="mt-4">
          <AccessTab data={data} canWrite={canWrite} busy={busy} mutate={mutate} />
        </TabsContent>
        <TabsContent value="providers" className="mt-4">
          <ProviderTab providers={data.providers} canWrite={canWrite} busy={busy} mutate={mutate} />
        </TabsContent>
        <TabsContent value="webhooks" className="mt-4">
          <WebhookTab data={data} canWrite={canWrite} busy={busy} mutate={mutate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Mutate = (key: string, path: string, method: string, body?: unknown) => Promise<boolean>;

function TenantNetworkTab({ data, members, selectedTenant, setSelectedTenant, canWrite, busy, mutate }: {
  data: PlatformData;
  members: Member[];
  selectedTenant: string;
  setSelectedTenant: (id: string) => void;
  canWrite: boolean;
  busy: string | null;
  mutate: Mutate;
}) {
  const t = useTranslations("admin.platform");
  const [tenant, setTenant] = useState({ slug: "", name: "" });
  const [member, setMember] = useState({ userId: "", role: "MEMBER" });
  const [network, setNetwork] = useState({ name: "", routingDomain: "" });
  const [networkId, setNetworkId] = useState("");
  const [subnet, setSubnet] = useState({ name: "", cidr: "", gateway: "" });
  const selectedNetworks = data.networks.filter((item) => item.tenantId === selectedTenant);
  const activeNetworkId = networkId || selectedNetworks[0]?.id || "";

  return (
    <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
      <section className="space-y-3 border-r border-neutral-200 pr-6">
        <SectionTitle>{t("tenantList")}</SectionTitle>
        <Select value={selectedTenant} onValueChange={setSelectedTenant}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{data.tenants.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
        <div className="divide-y rounded-md border">
          {data.tenants.map((item) => (
            <button key={item.id} type="button" onClick={() => setSelectedTenant(item.id)} className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-neutral-50">
              <span><span className="block text-sm font-medium">{item.name}</span><span className="text-xs text-neutral-400">{item.slug}</span></span>
              <Badge variant="secondary">{item._count.memberships}</Badge>
            </button>
          ))}
          {!data.tenants.length && <Empty text={t("empty")} />}
        </div>
        {canWrite && <InlineForm onSubmit={() => mutate("tenant", "/api/admin/tenants", "POST", tenant).then((ok) => { if (ok) setTenant({ slug: "", name: "" }); })} disabled={!tenant.slug || !tenant.name || busy !== null}>
          <Field label={t("name")}><Input value={tenant.name} onChange={(event) => setTenant({ ...tenant, name: event.target.value })} /></Field>
          <Field label={t("slug")}><Input value={tenant.slug} onChange={(event) => setTenant({ ...tenant, slug: event.target.value.toLowerCase() })} /></Field>
        </InlineForm>}
      </section>

      <div className="space-y-7">
        <section className="space-y-3">
          <SectionTitle>{t("members")}</SectionTitle>
          <div className="flex flex-wrap gap-2">{members.map((item) => <Badge key={item.userId} variant="outline">{item.user.realName ?? item.user.email} · {t(`memberRole.${item.role}`)}</Badge>)}</div>
          {canWrite && selectedTenant && <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
            <Select value={member.userId} onValueChange={(value) => setMember({ ...member, userId: value })}><SelectTrigger><SelectValue placeholder={t("selectUser")} /></SelectTrigger><SelectContent>{data.users.map((user) => <SelectItem key={user.id} value={user.id}>{user.realName ?? user.email}</SelectItem>)}</SelectContent></Select>
            <Select value={member.role} onValueChange={(value) => setMember({ ...member, role: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MEMBER">{t("memberRole.MEMBER")}</SelectItem><SelectItem value="MANAGER">{t("memberRole.MANAGER")}</SelectItem></SelectContent></Select>
            <Button disabled={!member.userId || busy !== null} onClick={() => mutate("member", `/api/admin/tenants/${selectedTenant}/members`, "POST", member)}><Plus />{t("add")}</Button>
          </div>}
        </section>

        <section className="space-y-3">
          <SectionTitle>{t("networks")}</SectionTitle>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm"><thead className="bg-neutral-50 text-left text-xs text-neutral-500"><tr><th className="px-3 py-2">{t("name")}</th><th className="px-3 py-2">{t("routingDomain")}</th><th className="px-3 py-2">{t("subnets")}</th></tr></thead><tbody className="divide-y">{selectedNetworks.map((item) => <tr key={item.id}><td className="px-3 py-2 font-medium">{item.name}</td><td className="px-3 py-2 font-mono text-xs">{item.routingDomain}</td><td className="px-3 py-2">{item.subnets.map((entry) => <Badge key={entry.id} className="mr-1" variant="outline">{entry.name} · {entry.cidr}</Badge>)}</td></tr>)}</tbody></table>
          </div>
          {canWrite && selectedTenant && <InlineForm onSubmit={() => mutate("network", "/api/admin/networks", "POST", { tenantId: selectedTenant, ...network }).then((ok) => { if (ok) setNetwork({ name: "", routingDomain: "" }); })} disabled={!network.name || !network.routingDomain || busy !== null} columns={2}>
            <Field label={t("name")}><Input value={network.name} onChange={(event) => setNetwork({ ...network, name: event.target.value })} /></Field>
            <Field label={t("routingDomain")}><Input value={network.routingDomain} onChange={(event) => setNetwork({ ...network, routingDomain: event.target.value })} /></Field>
          </InlineForm>}
        </section>

        {canWrite && selectedNetworks.length > 0 && <section className="space-y-3">
          <SectionTitle>{t("addSubnet")}</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-3">
            <Select value={activeNetworkId} onValueChange={setNetworkId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{selectedNetworks.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
            <Input value={subnet.name} onChange={(event) => setSubnet({ ...subnet, name: event.target.value })} placeholder={t("name")} />
            <Input value={subnet.cidr} onChange={(event) => setSubnet({ ...subnet, cidr: event.target.value })} placeholder={t("cidr")} />
            <Input value={subnet.gateway} onChange={(event) => setSubnet({ ...subnet, gateway: event.target.value })} placeholder={t("gateway")} />
            <Button disabled={!activeNetworkId || !subnet.name || !subnet.cidr || busy !== null} onClick={() => mutate("subnet", `/api/admin/networks/${activeNetworkId}/subnets`, "POST", { ...subnet, gateway: subnet.gateway || undefined }).then((ok) => { if (ok) setSubnet({ name: "", cidr: "", gateway: "" }); })}><Plus />{t("add")}</Button>
          </div>
        </section>}
      </div>
    </div>
  );
}

function AccessTab({ data, canWrite, busy, mutate }: { data: PlatformData; canWrite: boolean; busy: string | null; mutate: Mutate }) {
  const t = useTranslations("admin.platform");
  const [gateway, setGateway] = useState({ tenantId: "global", name: "", mode: "FRPC_CONFIG", apiUrl: "", publicHost: "", secret: "", tlsVerify: true });
  const [zone, setZone] = useState({ tenantId: "", domain: "", mode: "CONFIG_EXPORT", apiUrl: "", secret: "", tlsVerify: true });
  return <div className="space-y-8">
    <section className="space-y-3"><SectionTitle>{t("reverseProxyGateways")}</SectionTitle><DataRows rows={data.gateways.map((item) => ({ id: item.id, primary: item.name, secondary: `${item.mode} · ${item.publicHost}`, status: item.enabled ? t("enabled") : t("disabled") }))} empty={t("empty")} actions={canWrite ? (id) => <DeleteButton busy={busy === `gateway-${id}`} label={t("delete")} onClick={() => mutate(`gateway-${id}`, `/api/admin/reverse-proxy-gateways/${id}`, "DELETE")} /> : undefined} />
      {canWrite && <InlineForm columns={3} disabled={!gateway.name || !gateway.publicHost || (gateway.mode === "FRP_HTTP_API" && !gateway.apiUrl) || busy !== null} onSubmit={() => mutate("gateway-create", "/api/admin/reverse-proxy-gateways", "POST", { ...gateway, tenantId: gateway.tenantId === "global" ? null : gateway.tenantId, apiUrl: gateway.apiUrl || null, secret: gateway.secret || undefined })}>
        <Field label={t("tenantScope")}><TenantSelect tenants={data.tenants} value={gateway.tenantId} onChange={(value) => setGateway({ ...gateway, tenantId: value })} global /></Field><Field label={t("name")}><Input value={gateway.name} onChange={(event) => setGateway({ ...gateway, name: event.target.value })} /></Field><Field label={t("mode")}><Select value={gateway.mode} onValueChange={(value) => setGateway({ ...gateway, mode: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FRPC_CONFIG">FRPC_CONFIG</SelectItem><SelectItem value="FRP_HTTP_API">FRP_HTTP_API</SelectItem></SelectContent></Select></Field><Field label={t("publicHost")}><Input value={gateway.publicHost} onChange={(event) => setGateway({ ...gateway, publicHost: event.target.value })} /></Field><Field label={t("apiUrl")}><Input value={gateway.apiUrl} onChange={(event) => setGateway({ ...gateway, apiUrl: event.target.value })} /></Field><Field label={t("secret")}><Input type="password" value={gateway.secret} onChange={(event) => setGateway({ ...gateway, secret: event.target.value })} /></Field>
      </InlineForm>}
    </section>
    <section className="space-y-3"><SectionTitle>{t("dnsZones")}</SectionTitle><DataRows rows={data.dnsZones.map((item) => ({ id: item.id, primary: item.domain, secondary: `${item.mode} · ${item.records.length} ${t("records")}`, status: item.records.some((record) => record.status === "FAILED") ? "FAILED" : "ACTIVE" }))} empty={t("empty")} actions={(id) => <div className="flex gap-1"><Button asChild size="icon-sm" variant="ghost" title={t("export")}><a href={`/api/admin/dns-zones/${id}/export`}><Download /><span className="sr-only">{t("export")}</span></a></Button>{canWrite && <><Button size="icon-sm" variant="ghost" title={t("reconcile")} disabled={busy !== null} onClick={() => mutate(`dns-sync-${id}`, `/api/admin/dns-zones/${id}/reconcile`, "POST")}><RotateCw className={busy === `dns-sync-${id}` ? "animate-spin" : ""} /><span className="sr-only">{t("reconcile")}</span></Button><DeleteButton busy={busy === `dns-delete-${id}`} label={t("delete")} onClick={() => mutate(`dns-delete-${id}`, `/api/admin/dns-zones/${id}`, "DELETE")} /></>}</div>} />
      {canWrite && <InlineForm columns={3} disabled={!zone.tenantId || !zone.domain || (zone.mode === "HTTP_API" && !zone.apiUrl) || busy !== null} onSubmit={() => mutate("dns-create", "/api/admin/dns-zones", "POST", { ...zone, apiUrl: zone.apiUrl || null, secret: zone.secret || undefined })}>
        <Field label={t("tenantScope")}><TenantSelect tenants={data.tenants} value={zone.tenantId} onChange={(value) => setZone({ ...zone, tenantId: value })} /></Field><Field label={t("domain")}><Input value={zone.domain} onChange={(event) => setZone({ ...zone, domain: event.target.value.toLowerCase() })} /></Field><Field label={t("mode")}><Select value={zone.mode} onValueChange={(value) => setZone({ ...zone, mode: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CONFIG_EXPORT">CONFIG_EXPORT</SelectItem><SelectItem value="HTTP_API">HTTP_API</SelectItem></SelectContent></Select></Field><Field label={t("apiUrl")}><Input value={zone.apiUrl} onChange={(event) => setZone({ ...zone, apiUrl: event.target.value })} /></Field><Field label={t("secret")}><Input type="password" value={zone.secret} onChange={(event) => setZone({ ...zone, secret: event.target.value })} /></Field>
      </InlineForm>}
    </section>
    <section className="space-y-3"><SectionTitle>{t("activeMappings")}</SectionTitle><DataRows rows={data.mappings.map((item) => ({ id: item.id, primary: item.hostname ?? `${item.gateway.publicHost}:${item.externalPort}`, secondary: `${item.protocol} · ${item.internalHost}:${item.internalPort}`, status: item.status }))} empty={t("empty")} actions={canWrite ? (id) => <div className="flex gap-1"><Button asChild size="icon-sm" variant="ghost" title={t("export")}><a href={`/api/admin/external-access/${id}/export`}><Download /><span className="sr-only">{t("export")}</span></a></Button><Button size="icon-sm" variant="ghost" title={t("reconcile")} disabled={busy !== null} onClick={() => mutate(`map-sync-${id}`, `/api/admin/external-access/${id}/reconcile`, "POST")}><RotateCw className={busy === `map-sync-${id}` ? "animate-spin" : ""} /><span className="sr-only">{t("reconcile")}</span></Button><DeleteButton busy={busy === `map-delete-${id}`} label={t("delete")} onClick={() => mutate(`map-delete-${id}`, `/api/admin/external-access/${id}`, "DELETE")} /></div> : undefined} /></section>
  </div>;
}

function ProviderTab({ providers, canWrite, busy, mutate }: { providers: Provider[]; canWrite: boolean; busy: string | null; mutate: Mutate }) {
  const t = useTranslations("admin.platform");
  const [form, setForm] = useState({ name: "", type: "CUSTOM", config: "{}", secret: "" });
  const parsedConfig = useMemo(() => { try { return JSON.parse(form.config) as unknown; } catch { return null; } }, [form.config]);
  return <div className="space-y-4"><DataRows rows={providers.map((item) => ({ id: item.id, primary: item.name, secondary: `${item.type} · ${item._count.resources} ${t("resources")}`, status: item.status }))} empty={t("empty")} actions={canWrite ? (id) => <DeleteButton busy={busy === `provider-${id}`} label={t("delete")} onClick={() => mutate(`provider-${id}`, `/api/admin/providers/${id}`, "DELETE")} /> : undefined} />
    {canWrite && <InlineForm columns={2} disabled={!form.name || parsedConfig === null || busy !== null} onSubmit={() => mutate("provider-create", "/api/admin/providers", "POST", { name: form.name, type: form.type, config: parsedConfig, secret: form.secret || undefined })}><Field label={t("name")}><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label={t("providerType")}><Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["ESXI", "FNOS", "AWS", "CUSTOM"].map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></Field><Field label={t("providerConfig")}><Textarea rows={4} className="font-mono text-xs" value={form.config} onChange={(event) => setForm({ ...form, config: event.target.value })} /></Field><Field label={t("secret")}><Input type="password" value={form.secret} onChange={(event) => setForm({ ...form, secret: event.target.value })} /></Field></InlineForm>}
  </div>;
}

function WebhookTab({ data, canWrite, busy, mutate }: { data: PlatformData; canWrite: boolean; busy: string | null; mutate: Mutate }) {
  const t = useTranslations("admin.platform");
  const [form, setForm] = useState({ name: "", url: "", tenantId: "global", signingSecret: "", enabled: true, events: [...WEBHOOK_EVENTS] as string[] });
  return <div className="space-y-4"><DataRows rows={data.webhooks.map((item) => ({ id: item.id, primary: item.name, secondary: `${item.url} · ${item._count.deliveries} ${t("deliveries")}`, status: item.enabled ? t("enabled") : t("disabled") }))} empty={t("empty")} actions={canWrite ? (id) => <DeleteButton busy={busy === `webhook-${id}`} label={t("delete")} onClick={() => mutate(`webhook-${id}`, `/api/admin/webhooks/${id}`, "DELETE")} /> : undefined} />
    {canWrite && <InlineForm columns={2} disabled={!form.name || !form.url || form.events.length === 0 || busy !== null} onSubmit={() => mutate("webhook-create", "/api/admin/webhooks", "POST", { ...form, tenantId: form.tenantId === "global" ? null : form.tenantId, signingSecret: form.signingSecret || undefined })}><Field label={t("name")}><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label={t("tenantScope")}><TenantSelect tenants={data.tenants} value={form.tenantId} onChange={(value) => setForm({ ...form, tenantId: value })} global /></Field><Field label={t("webhookUrl")}><Input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} /></Field><Field label={t("signingSecret")}><Input type="password" value={form.signingSecret} onChange={(event) => setForm({ ...form, signingSecret: event.target.value })} /></Field><div className="col-span-full flex flex-wrap gap-3">{WEBHOOK_EVENTS.map((event) => <label key={event} className="flex items-center gap-2 text-xs"><Switch checked={form.events.includes(event)} onCheckedChange={(checked) => setForm({ ...form, events: checked ? [...form.events, event] : form.events.filter((item) => item !== event) })} />{t(`event.${event}`)}</label>)}</div></InlineForm>}
  </div>;
}

function InlineForm({ children, onSubmit, disabled, columns = 1 }: { children: React.ReactNode; onSubmit: () => void; disabled: boolean; columns?: number }) {
  const t = useTranslations("admin.platform");
  return <div className={`grid gap-3 rounded-md border border-dashed bg-neutral-50/50 p-3 ${columns === 3 ? "md:grid-cols-3" : columns === 2 ? "md:grid-cols-2" : ""}`}>{children}<div className="col-span-full flex justify-end"><Button disabled={disabled} onClick={onSubmit}><Plus />{t("create")}</Button></div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1"><Label className="text-xs text-neutral-500">{label}</Label>{children}</div>; }
function SectionTitle({ children }: { children: React.ReactNode }) { return <h2 className="text-sm font-semibold">{children}</h2>; }
function Empty({ text }: { text: string }) { return <div className="px-3 py-8 text-center text-sm text-neutral-400">{text}</div>; }

function DataRows({ rows, empty, actions }: { rows: { id: string; primary: string; secondary: string; status: string }[]; empty: string; actions?: (id: string) => React.ReactNode }) {
  return <div className="divide-y overflow-hidden rounded-md border">{rows.map((row) => <div key={row.id} className="flex min-h-14 items-center gap-3 px-3 py-2"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{row.primary}</p><p className="truncate text-xs text-neutral-400">{row.secondary}</p></div><Badge variant="secondary">{row.status}</Badge>{actions?.(row.id)}</div>)}{!rows.length && <Empty text={empty} />}</div>;
}

function DeleteButton({ busy, label, onClick }: { busy: boolean; label: string; onClick: () => void }) { return <Button size="icon-sm" variant="ghost" title={label} disabled={busy} onClick={() => { if (window.confirm(`${label}?`)) onClick(); }}>{busy ? <Loader2 className="animate-spin" /> : <Trash2 className="text-red-500" />}<span className="sr-only">{label}</span></Button>; }

function TenantSelect({ tenants, value, onChange, global = false }: { tenants: Tenant[]; value: string; onChange: (value: string) => void; global?: boolean }) {
  const t = useTranslations("admin.platform");
  return <Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{global && <SelectItem value="global">{t("global")}</SelectItem>}{tenants.map((tenant) => <SelectItem key={tenant.id} value={tenant.id}>{tenant.name}</SelectItem>)}</SelectContent></Select>;
}
