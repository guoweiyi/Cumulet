"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BadgeCheck, CircleOff, Network, Plug, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type NodeRow = {
  id: string;
  name: string;
  nodeName: string;
  apiUrl: string;
  tokenId: string;
  tlsVerify: boolean;
  verified: boolean;
  verifiedAt: string | null;
  _count: { bindings: number };
};

const EMPTY = {
  name: "",
  nodeName: "",
  apiUrl: "https://",
  tokenId: "",
  tokenSecret: "",
  tlsVerify: true,
};

export function NodesManager({ canWrite }: { canWrite: boolean }) {
  const t = useTranslations("admin.node");
  const tc = useTranslations("common");
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/nodes", { cache: "no-store" });
    if (res.ok) setNodes((await res.json()).nodes);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(n: NodeRow) {
    setEditing(n.id);
    setForm({
      name: n.name,
      nodeName: n.nodeName,
      apiUrl: n.apiUrl,
      tokenId: n.tokenId,
      tokenSecret: "",
      tlsVerify: n.tlsVerify,
    });
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(editing ? `/api/admin/nodes/${editing}` : "/api/admin/nodes", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing && !form.tokenSecret ? { ...form, tokenSecret: undefined } : form),
      });
      if (!res.ok) {
        toast.error(tc("saveFailed"));
        return;
      }
      toast.success(tc("saveSuccess"));
      setOpen(false);
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function test(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/nodes/${id}/test`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        toast.success(`${tc("connectionOk")} — PVE ${data.version}`);
      } else {
        toast.error(`${tc("connectionFailed")}${data?.message ? `: ${data.message}` : ""}`);
      }
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm(t("deleteConfirm"))) return;
    const res = await fetch(`/api/admin/nodes/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error?.message ?? tc("requestFailed"));
      return;
    }
    void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        {canWrite && (
          <Button onClick={openCreate}>
            <Plus className="size-4" /> {t("add")}
          </Button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {nodes.map((n) => (
          <Card key={n.id}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Network className="size-4 text-blue-600" />
                <span className="font-medium">{n.name}</span>
                <code className="text-xs text-neutral-400">{n.nodeName}</code>
                {n.verified ? (
                  <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
                    <BadgeCheck className="size-3" /> {t("verified")}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-neutral-100 text-neutral-500">
                    <CircleOff className="size-3" /> {t("unverified")}
                  </Badge>
                )}
              </div>
              <p className="mt-1.5 text-xs text-neutral-500">{n.apiUrl}</p>
              <p className="text-xs text-neutral-400">
                {n.tokenId} · {n._count.bindings} VMs
              </p>
              {canWrite && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => test(n.id)}>
                    <Plug className="size-3.5" /> {tc("testConnection")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(n)}>
                    {tc("edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-500"
                    onClick={() => remove(n.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? tc("edit") : t("add")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("displayName")}>
              <Input value={form.name} placeholder="AZ 1" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t("nodeName")}>
              <Input value={form.nodeName} placeholder="cnta" onChange={(e) => setForm({ ...form, nodeName: e.target.value })} />
            </Field>
            <div className="col-span-2">
              <Field label={t("apiUrl")}>
                <Input value={form.apiUrl} placeholder="https://pve1.example.com:8006" onChange={(e) => setForm({ ...form, apiUrl: e.target.value })} />
              </Field>
            </div>
            <Field label={t("tokenId")}>
              <Input value={form.tokenId} placeholder="root@pam!cumulet" onChange={(e) => setForm({ ...form, tokenId: e.target.value })} />
            </Field>
            <Field label={t("tokenSecret")}>
              <Input
                type="password"
                value={form.tokenSecret}
                placeholder={editing ? t("tokenSecretHint") : ""}
                onChange={(e) => setForm({ ...form, tokenSecret: e.target.value })}
              />
            </Field>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <Switch checked={form.tlsVerify} onCheckedChange={(v) => setForm({ ...form, tlsVerify: v })} />
              {t("tlsVerify")}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={busy || !form.name || !form.nodeName || !form.tokenId || (!editing && !form.tokenSecret)}
              onClick={save}
            >
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-neutral-500">{label}</Label>
      {children}
    </div>
  );
}
