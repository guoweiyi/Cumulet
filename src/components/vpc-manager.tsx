"use client";

import { useCallback, useEffect, useState } from "react";
import { Network, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Vpc = {
  id: string;
  name: string;
  routingDomain: string;
  subnets: Array<{ id: string; name: string; cidr: string; gateway: string | null; _count: { attachments: number } }>;
};

const EMPTY = { name: "", subnetName: "default", cidr: "10.0.0.0/24", gateway: "" };

export function VpcManager() {
  const t = useTranslations("vpc");
  const [vpcs, setVpcs] = useState<Vpc[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch("/api/vpcs");
    if (res.ok) setVpcs((await res.json()).vpcs);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/vpcs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error(data?.error?.message || t("failed")); return; }
      setForm(EMPTY);
      await load();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm(t("deleteConfirm"))) return;
    const res = await fetch(`/api/vpcs/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => null);
    if (!res.ok) { toast.error(data?.error?.message || t("failed")); return; }
    await load();
  }

  return <div className="space-y-4">
    <div className="grid gap-3 border-y py-4 md:grid-cols-4">
      <Field label={t("name")}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label={t("subnetName")}><Input value={form.subnetName} onChange={(e) => setForm({ ...form, subnetName: e.target.value })} /></Field>
      <Field label={t("cidr")}><Input className="font-mono" value={form.cidr} onChange={(e) => setForm({ ...form, cidr: e.target.value })} /></Field>
      <Field label={t("gateway")}><Input className="font-mono" value={form.gateway} onChange={(e) => setForm({ ...form, gateway: e.target.value })} /></Field>
      <div className="flex justify-end md:col-span-4"><Button disabled={busy || !form.name || !form.cidr} onClick={create}><Plus />{t("create")}</Button></div>
    </div>
    {!vpcs.length && <div className="py-16 text-center text-sm text-muted-foreground">{t("empty")}</div>}
    <div className="grid gap-3 md:grid-cols-2">
      {vpcs.map((vpc) => <div key={vpc.id} className="rounded-md border p-4">
        <div className="flex items-start gap-3"><div className="flex size-9 items-center justify-center rounded-md bg-secondary"><Network className="size-4" /></div><div className="min-w-0 flex-1"><div className="font-medium">{vpc.name}</div><div className="font-mono text-xs text-muted-foreground">{vpc.routingDomain}</div></div><Button size="icon-sm" variant="ghost" title={t("delete")} onClick={() => remove(vpc.id)}><Trash2 className="size-4 text-red-500" /></Button></div>
        <div className="mt-3 flex flex-wrap gap-2">{vpc.subnets.map((subnet) => <Badge key={subnet.id} variant="outline">{subnet.name} · {subnet.cidr} · {t("servers", { count: subnet._count.attachments })}</Badge>)}</div>
      </div>)}
    </div>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
