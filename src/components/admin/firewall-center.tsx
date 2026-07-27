"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Loader2, Plus, Shield, Trash2 } from "lucide-react";
import { localized, type I18nText } from "@/i18n/config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Group = {
  name: string;
  inPve: boolean;
  description: I18nText | null;
  scope: "ADMIN_ONLY" | "SHARED";
  isProvisioningDefault: boolean;
};
type GroupRule = {
  pos: number;
  type: string;
  action: string;
  proto?: string;
  dport?: string;
  source?: string;
  comment?: string;
  enable?: number;
};

export function FirewallCenter({
  canWrite,
  hasNodes,
  nodes,
  bindings,
}: {
  canWrite: boolean;
  hasNodes: boolean;
  nodes: { id: string; name: string }[];
  bindings: { id: string; vmid: number; node: string }[];
}) {
  const t = useTranslations("admin.sg");
  const tc = useTranslations("common");

  if (!hasNodes) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-neutral-400">
          {tc("connectionFailed")} — {t("syncFromPve")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        {canWrite && nodes.length > 1 && <SyncDialog nodes={nodes} />}
      </div>
      <Tabs defaultValue="groups">
        <TabsList>
          <TabsTrigger value="groups">{t("title")}</TabsTrigger>
          <TabsTrigger value="ipsets">{t("ipsets")}</TabsTrigger>
          <TabsTrigger value="aliases">{t("aliases")}</TabsTrigger>
          <TabsTrigger value="effective">{t("effectiveRules")}</TabsTrigger>
        </TabsList>
        <TabsContent value="groups">
          <GroupsPane canWrite={canWrite} nodes={nodes} />
        </TabsContent>
        <TabsContent value="ipsets">
          <IpsetsPane canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="aliases">
          <AliasesPane canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="effective">
          <EffectivePane bindings={bindings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Security groups two-pane ------------------------------------------------

function GroupsPane({ canWrite, nodes }: { canWrite: boolean; nodes: { id: string; name: string }[] }) {
  const t = useTranslations("admin.sg");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [rules, setRules] = useState<GroupRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/firewall/groups", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setGroups(data.groups);
      if (!selected && data.groups[0]) setSelected(data.groups[0].name);
    }
    setLoading(false);
  }, [selected]);

  const loadRules = useCallback(async (name: string) => {
    const res = await fetch(`/api/admin/firewall/groups/${encodeURIComponent(name)}/rules`, {
      cache: "no-store",
    });
    setRules(res.ok ? (await res.json()).rules : []);
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);
  useEffect(() => {
    if (selected) void loadRules(selected);
  }, [selected, loadRules]);

  async function deleteGroup(name: string) {
    if (!confirm(t("deleteConfirm"))) return;
    const res = await fetch(`/api/admin/firewall/groups/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error(tc("requestFailed"));
      return;
    }
    setSelected(null);
    void loadGroups();
  }

  async function deleteRule(pos: number) {
    if (!selected || !confirm(tc("confirm") + "?")) return;
    const res = await fetch(
      `/api/admin/firewall/groups/${encodeURIComponent(selected)}/rules/${pos}`,
      { method: "DELETE" },
    );
    if (res.ok) void loadRules(selected);
    else toast.error(tc("requestFailed"));
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-5 animate-spin text-neutral-300" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      {/* Left: group list */}
      <Card className="h-fit">
        <CardContent className="p-2">
          {canWrite && (
            <Button size="sm" className="mb-2 w-full" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" /> {t("add")}
            </Button>
          )}
          <ul className="space-y-0.5">
            {groups.map((g) => (
              <li key={g.name}>
                <button
                  onClick={() => setSelected(g.name)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm",
                    selected === g.name ? "bg-blue-50 text-blue-700" : "hover:bg-neutral-100",
                  )}
                >
                  <Shield className="size-3.5 shrink-0" />
                  <span className="flex-1 truncate">{g.name}</span>
                  {g.scope === "SHARED" && (
                    <Badge variant="secondary" className="text-[9px]">
                      {t("shared")}
                    </Badge>
                  )}
                  {g.isProvisioningDefault && (
                    <Badge variant="secondary" className="bg-blue-100 text-[9px] text-blue-700">
                      ★
                    </Badge>
                  )}
                  {!g.inPve && (
                    <Badge variant="outline" className="text-[9px] text-amber-600">
                      {t("notInPve")}
                    </Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Right: rules table */}
      <Card>
        <CardContent className="p-4">
          {!selected ? (
            <p className="py-10 text-center text-sm text-neutral-400">{tc("empty")}</p>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <span className="font-medium">{selected}</span>
                {groups.find((g) => g.name === selected)?.description && (
                  <span className="text-xs text-neutral-500">
                    {localized(groups.find((g) => g.name === selected)!.description!, locale)}
                  </span>
                )}
                <div className="flex-1" />
                {canWrite && (
                  <>
                    {nodes.length > 1 && (
                      <SyncDialog
                        nodes={nodes}
                        groupName={selected}
                        compact
                        onDone={() => {
                          void loadGroups();
                          void loadRules(selected);
                        }}
                      />
                    )}
                    <Button size="sm" variant="outline" onClick={() => setRuleOpen(true)}>
                      <Plus className="size-3.5" /> {t("rules")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500"
                      onClick={() => deleteGroup(selected)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("position")}</TableHead>
                    <TableHead>Dir</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Proto</TableHead>
                    <TableHead>Dport</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Comment</TableHead>
                    {canWrite && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((r) => (
                    <TableRow key={r.pos}>
                      <TableCell>{r.pos}</TableCell>
                      <TableCell>{r.type}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={
                            r.action === "ACCEPT"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-600"
                          }
                        >
                          {r.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="uppercase">{r.proto ?? "—"}</TableCell>
                      <TableCell>{r.dport ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.source ?? "—"}</TableCell>
                      <TableCell className="max-w-32 truncate text-xs text-neutral-500">
                        {r.comment ?? ""}
                      </TableCell>
                      {canWrite && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-red-500"
                            onClick={() => deleteRule(r.pos)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {rules.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canWrite ? 8 : 7} className="py-8 text-center text-sm text-neutral-400">
                        {tc("empty")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {canWrite && (
        <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} onDone={loadGroups} />
      )}
      {canWrite && selected && (
        <AddRuleDialog
          group={selected}
          open={ruleOpen}
          onOpenChange={setRuleOpen}
          onDone={() => loadRules(selected)}
        />
      )}
    </div>
  );
}

function SyncDialog({
  nodes,
  groupName,
  compact = false,
  onDone,
}: {
  nodes: { id: string; name: string }[];
  groupName?: string;
  compact?: boolean;
  onDone?: () => void;
}) {
  const t = useTranslations("admin.sg");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [sourceNodeId, setSourceNodeId] = useState(nodes[0]?.id ?? "");
  const [targetNodeIds, setTargetNodeIds] = useState<string[]>(
    nodes.slice(1).map((node) => node.id),
  );
  const [mode, setMode] = useState<"merge" | "mirror">("merge");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<
    { nodeId: string; node: string; ok: boolean; changes?: Record<string, number>; error?: string }[]
  >([]);

  function changeSource(id: string) {
    setSourceNodeId(id);
    setTargetNodeIds((current) => current.filter((target) => target !== id));
  }

  function toggleTarget(id: string, checked: boolean) {
    setTargetNodeIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((target) => target !== id),
    );
  }

  async function run() {
    if (targetNodeIds.length === 0) return;
    if (mode === "mirror" && !confirm(t("mirrorConfirm"))) return;
    setBusy(true);
    setResults([]);
    try {
      const res = await fetch("/api/admin/firewall/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceNodeId,
          targetNodeIds,
          mode,
          scope: groupName ? "group" : "all",
          groupName,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.results) {
        toast.error(tc("requestFailed"));
        return;
      }
      setResults(data.results);
      if (data.results.every((result: { ok: boolean }) => result.ok)) {
        toast.success(t("syncComplete"));
        onDone?.();
      } else {
        toast.error(t("syncPartial"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Copy className="size-3.5" />
        {!compact && (groupName ? t("syncGroup") : t("syncAll"))}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{groupName ? t("syncGroupTitle", { name: groupName }) : t("syncAllTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("sourceZone")}</Label>
              <Select value={sourceNodeId} onValueChange={changeSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {nodes.map((node) => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("targetZones")}</Label>
              {nodes.filter((node) => node.id !== sourceNodeId).map((node) => (
                <label key={node.id} className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                  <Checkbox
                    checked={targetNodeIds.includes(node.id)}
                    onCheckedChange={(checked) => toggleTarget(node.id, checked === true)}
                  />
                  {node.name}
                </label>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>{t("syncMode")}</Label>
              <Select value={mode} onValueChange={(value) => setMode(value as "merge" | "mirror")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="merge">{t("mergeMode")}</SelectItem>
                  <SelectItem value="mirror">{t("mirrorMode")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {mode === "merge" ? t("mergeHint") : t("mirrorHint")}
              </p>
            </div>
            {results.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                {results.map((result) => {
                  const count = result.changes
                    ? Object.values(result.changes).reduce((sum, value) => sum + value, 0)
                    : 0;
                  return (
                    <div key={result.nodeId} className="flex items-start justify-between gap-3 text-sm">
                      <span>{result.node}</span>
                      <span className={result.ok ? "text-emerald-600" : "max-w-72 text-right text-red-600"}>
                        {result.ok ? t("syncChanges", { count }) : result.error}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{tc("cancel")}</Button>
            <Button disabled={busy || targetNodeIds.length === 0} onClick={run}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("startSync")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateGroupDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const t = useTranslations("admin.sg");
  const tc = useTranslations("common");
  const [form, setForm] = useState({ name: "", zh: "", en: "", scope: "ADMIN_ONLY", isDefault: false });
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/firewall/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.zh ? { zh: form.zh, en: form.en || undefined } : null,
          scope: form.scope,
          isProvisioningDefault: form.isDefault,
        }),
      });
      if (!res.ok) {
        toast.error(tc("saveFailed"));
        return;
      }
      onOpenChange(false);
      setForm({ name: "", zh: "", en: "", scope: "ADMIN_ONLY", isDefault: false });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("add")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Labeled label={t("groupName")}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="web-basic" />
          </Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label={t("descZh")}>
              <Input value={form.zh} onChange={(e) => setForm({ ...form, zh: e.target.value })} />
            </Labeled>
            <Labeled label={t("descEn")}>
              <Input value={form.en} onChange={(e) => setForm({ ...form, en: e.target.value })} />
            </Labeled>
          </div>
          <Labeled label={t("scope")}>
            <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN_ONLY">{t("adminOnly")}</SelectItem>
                <SelectItem value="SHARED">{t("shared")}</SelectItem>
              </SelectContent>
            </Select>
          </Labeled>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.isDefault} onCheckedChange={(v) => setForm({ ...form, isDefault: v })} />
            {t("provisioningDefault")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button disabled={busy || !form.name} onClick={create}>
            {tc("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddRuleDialog({
  group,
  open,
  onOpenChange,
  onDone,
}: {
  group: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const tc = useTranslations("common");
  const [rule, setRule] = useState({
    direction: "in",
    action: "ACCEPT",
    proto: "tcp",
    dport: "",
    source: "",
    comment: "",
    enable: true,
  });
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/firewall/groups/${encodeURIComponent(group)}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...rule,
          proto: rule.proto || null,
          dport: rule.dport || null,
          source: rule.source || null,
          comment: rule.comment || null,
        }),
      });
      if (!res.ok) {
        toast.error(tc("requestFailed"));
        return;
      }
      onOpenChange(false);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{group}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Direction">
            <Select value={rule.direction} onValueChange={(v) => setRule({ ...rule, direction: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in">in</SelectItem>
                <SelectItem value="out">out</SelectItem>
              </SelectContent>
            </Select>
          </Labeled>
          <Labeled label="Action">
            <Select value={rule.action} onValueChange={(v) => setRule({ ...rule, action: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ACCEPT">ACCEPT</SelectItem>
                <SelectItem value="DROP">DROP</SelectItem>
                <SelectItem value="REJECT">REJECT</SelectItem>
              </SelectContent>
            </Select>
          </Labeled>
          <Labeled label="Proto">
            <Select value={rule.proto} onValueChange={(v) => setRule({ ...rule, proto: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tcp">TCP</SelectItem>
                <SelectItem value="udp">UDP</SelectItem>
                <SelectItem value="icmp">ICMP</SelectItem>
              </SelectContent>
            </Select>
          </Labeled>
          <Labeled label="Dport">
            <Input value={rule.dport} placeholder="80,443" onChange={(e) => setRule({ ...rule, dport: e.target.value })} />
          </Labeled>
          <Labeled label="Source">
            <Input value={rule.source} placeholder="0.0.0.0/0 / +ipset" onChange={(e) => setRule({ ...rule, source: e.target.value })} />
          </Labeled>
          <Labeled label="Comment">
            <Input value={rule.comment} onChange={(e) => setRule({ ...rule, comment: e.target.value })} />
          </Labeled>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
          <Button disabled={busy} onClick={add}>{tc("add")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- IPSets ------------------------------------------------------------------

function IpsetsPane({ canWrite }: { canWrite: boolean }) {
  const t = useTranslations("admin.sg");
  const tc = useTranslations("common");
  const [ipsets, setIpsets] = useState<{ name: string; comment?: string; entries: { cidr: string }[] }[]>([]);
  const [name, setName] = useState("");
  const [cidrByName, setCidrByName] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/firewall/ipsets", { cache: "no-store" });
    if (res.ok) setIpsets((await res.json()).ipsets);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function createIpset() {
    if (!name) return;
    const res = await fetch("/api/admin/firewall/ipsets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      setName("");
      void load();
    } else toast.error(tc("requestFailed"));
  }

  async function addEntry(ipset: string) {
    const cidr = cidrByName[ipset];
    if (!cidr) return;
    const res = await fetch(`/api/admin/firewall/ipsets/${encodeURIComponent(ipset)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cidr }),
    });
    if (res.ok) {
      setCidrByName((s) => ({ ...s, [ipset]: "" }));
      void load();
    } else toast.error(tc("invalidCidr" as never) || tc("requestFailed"));
  }

  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex gap-2">
          <Input value={name} placeholder={t("addIpset")} className="max-w-xs" onChange={(e) => setName(e.target.value)} />
          <Button onClick={createIpset}>
            <Plus className="size-4" /> {t("addIpset")}
          </Button>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {ipsets.map((s) => (
          <Card key={s.name}>
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-medium">{s.name}</span>
                {canWrite && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-red-500"
                    onClick={async () => {
                      if (confirm(t("deleteConfirm"))) {
                        await fetch(`/api/admin/firewall/ipsets/${encodeURIComponent(s.name)}`, { method: "DELETE" });
                        void load();
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
              <ul className="space-y-1">
                {s.entries.map((e) => (
                  <li key={e.cidr} className="flex items-center gap-2 text-xs">
                    <code className="rounded bg-neutral-100 px-1.5 py-0.5">{e.cidr}</code>
                    {canWrite && (
                      <button
                        className="text-neutral-400 hover:text-red-500"
                        onClick={async () => {
                          await fetch(
                            `/api/admin/firewall/ipsets/${encodeURIComponent(s.name)}?cidr=${encodeURIComponent(e.cidr)}`,
                            { method: "DELETE" },
                          );
                          void load();
                        }}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {canWrite && (
                <div className="mt-2 flex gap-1.5">
                  <Input
                    value={cidrByName[s.name] ?? ""}
                    placeholder="10.0.0.0/8"
                    className="h-8 text-xs"
                    onChange={(e) => setCidrByName((st) => ({ ...st, [s.name]: e.target.value }))}
                  />
                  <Button size="sm" variant="outline" onClick={() => addEntry(s.name)}>
                    <Plus className="size-3.5" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// --- Aliases -----------------------------------------------------------------

function AliasesPane({ canWrite }: { canWrite: boolean }) {
  const t = useTranslations("admin.sg");
  const tc = useTranslations("common");
  const [aliases, setAliases] = useState<{ name: string; cidr: string; comment?: string }[]>([]);
  const [form, setForm] = useState({ name: "", cidr: "" });

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/firewall/aliases", { cache: "no-store" });
    if (res.ok) setAliases((await res.json()).aliases);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function upsert() {
    if (!form.name || !form.cidr) return;
    const res = await fetch("/api/admin/firewall/aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm({ name: "", cidr: "" });
      void load();
    } else toast.error(tc("requestFailed"));
  }

  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex gap-2">
          <Input value={form.name} placeholder={t("addAlias")} className="max-w-40" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input value={form.cidr} placeholder="10.0.0.0/8" className="max-w-xs" onChange={(e) => setForm({ ...form, cidr: e.target.value })} />
          <Button onClick={upsert}>
            <Plus className="size-4" /> {t("addAlias")}
          </Button>
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc("name")}</TableHead>
                <TableHead>{t("cidr")}</TableHead>
                <TableHead>{tc("description")}</TableHead>
                {canWrite && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {aliases.map((a) => (
                <TableRow key={a.name}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="font-mono text-xs">{a.cidr}</TableCell>
                  <TableCell className="text-xs text-neutral-500">{a.comment ?? ""}</TableCell>
                  {canWrite && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-red-500"
                        onClick={async () => {
                          await fetch(`/api/admin/firewall/aliases/${encodeURIComponent(a.name)}`, { method: "DELETE" });
                          void load();
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {aliases.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canWrite ? 4 : 3} className="py-8 text-center text-sm text-neutral-400">
                    {tc("empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Effective rules viewer --------------------------------------------------

function EffectivePane({ bindings }: { bindings: { id: string; vmid: number; node: string }[] }) {
  const t = useTranslations("admin.sg");
  const tc = useTranslations("common");
  const [bindingId, setBindingId] = useState<string>(bindings[0]?.id ?? "");
  const [data, setData] = useState<{ enabled: boolean; rules: (GroupRule & { groupRules?: GroupRule[] })[] } | null>(null);

  useEffect(() => {
    if (!bindingId) return;
    setData(null);
    fetch(`/api/admin/firewall/effective?bindingId=${bindingId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData);
  }, [bindingId]);

  return (
    <div className="space-y-3">
      <Select value={bindingId} onValueChange={setBindingId}>
        <SelectTrigger className="max-w-xs">
          <SelectValue placeholder={t("selectVm")} />
        </SelectTrigger>
        <SelectContent>
          {bindings.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              VM {b.vmid} ({b.node})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {data && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-xs text-neutral-500">
              Firewall: {data.enabled ? tc("enabled") : tc("disabled")}
            </p>
            <ol className="space-y-1.5 text-sm">
              {data.rules.map((r, i) => (
                <li key={i} className="rounded border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{r.type}</Badge>
                    <span className="font-medium">{r.action}</span>
                    {r.proto && <span className="text-xs uppercase text-neutral-500">{r.proto}</span>}
                    {r.dport && <span className="text-xs">:{r.dport}</span>}
                    {r.source && <span className="font-mono text-xs text-neutral-400">{r.source}</span>}
                  </div>
                  {r.groupRules && (
                    <ul className="mt-1.5 space-y-1 border-l-2 pl-3 text-xs text-neutral-500">
                      {r.groupRules.map((gr, j) => (
                        <li key={j}>
                          {gr.type} {gr.action} {gr.proto ?? ""} {gr.dport ? `:${gr.dport}` : ""} {gr.source ?? ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-neutral-500">{label}</Label>
      {children}
    </div>
  );
}
