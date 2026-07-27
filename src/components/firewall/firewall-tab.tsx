"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Lock, Pencil, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { localized, type I18nText } from "@/i18n/config";
import { isValidCidr, isValidPortRange } from "@/lib/firewall";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type FwRule = {
  pos: number;
  direction: "in" | "out";
  action: string;
  proto: string | null;
  dport: string | null;
  sport: string | null;
  source: string | null;
  dest: string | null;
  comment: string | null;
  enabled: boolean;
  locked: boolean;
};

type FwState = {
  enabled: boolean;
  rules: FwRule[];
  attachedGroups: string[];
  availableGroups: { name: string; description: I18nText | null }[];
};

const PRESETS = {
  ssh: { proto: "tcp", dport: "22" },
  http: { proto: "tcp", dport: "80" },
  https: { proto: "tcp", dport: "443" },
} as const;

const EMPTY_RULE = {
  direction: "in" as "in" | "out",
  action: "ACCEPT" as "ACCEPT" | "DROP" | "REJECT",
  proto: "tcp" as string | null,
  dport: "",
  sport: "",
  source: "",
  dest: "",
  comment: "",
  enable: true,
};

export function FirewallTab({ bindingId }: { bindingId: string }) {
  const t = useTranslations("firewall");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [state, setState] = useState<FwState | null>(null);
  const [error, setError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editPos, setEditPos] = useState<number | null>(null);
  const [rule, setRule] = useState(EMPTY_RULE);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/vms/${bindingId}/firewall`, { cache: "no-store" });
      if (!res.ok) {
        setError(true);
        return;
      }
      setState(await res.json());
      setError(false);
    } catch {
      setError(true);
    }
  }, [bindingId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openAdd(preset?: keyof typeof PRESETS) {
    setEditPos(null);
    setRule({
      ...EMPTY_RULE,
      ...(preset ? PRESETS[preset] : {}),
      comment: preset ? preset.toUpperCase() : "",
    });
    setDialogOpen(true);
  }

  function openEdit(r: FwRule) {
    setEditPos(r.pos);
    setRule({
      direction: r.direction,
      action: r.action as typeof EMPTY_RULE.action,
      proto: r.proto,
      dport: r.dport ?? "",
      sport: r.sport ?? "",
      source: r.source ?? "",
      dest: r.dest ?? "",
      comment: r.comment ?? "",
      enable: r.enabled,
    });
    setDialogOpen(true);
  }

  function validate(): string | null {
    if (rule.dport && !isValidPortRange(rule.dport)) return t("invalidPort");
    if (rule.sport && !isValidPortRange(rule.sport)) return t("invalidPort");
    if (rule.source && !isValidCidr(rule.source)) return t("invalidCidr");
    if (rule.dest && !isValidCidr(rule.dest)) return t("invalidCidr");
    return null;
  }

  async function saveRule() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        ...rule,
        proto: rule.proto || null,
        dport: rule.dport || null,
        sport: rule.sport || null,
        source: rule.source || null,
        dest: rule.dest || null,
        comment: rule.comment || null,
      };
      const res = await fetch(
        editPos === null
          ? `/api/vms/${bindingId}/firewall`
          : `/api/vms/${bindingId}/firewall/rules/${editPos}`,
        {
          method: editPos === null ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (res.status === 422) {
        const data = await res.json().catch(() => null);
        toast.error(t("ruleLimit", { max: data?.error?.message ?? "" }));
        return;
      }
      if (!res.ok) {
        toast.error(tc("requestFailed"));
        return;
      }
      setDialogOpen(false);
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(pos: number) {
    if (!confirm(tc("confirm") + "?")) return;
    const res = await fetch(`/api/vms/${bindingId}/firewall/rules/${pos}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(t("deleted"));
      void load();
    } else {
      toast.error(tc("requestFailed"));
    }
  }

  async function attachGroup(name: string) {
    const res = await fetch(`/api/vms/${bindingId}/firewall/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) void load();
    else toast.error(tc("requestFailed"));
  }

  async function detachGroup(name: string) {
    const res = await fetch(
      `/api/vms/${bindingId}/firewall/groups?name=${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
    if (res.ok) void load();
    else toast.error(tc("requestFailed"));
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-neutral-400">
          {tc("connectionFailed")}
        </CardContent>
      </Card>
    );
  }
  if (!state) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-neutral-300" />
        </CardContent>
      </Card>
    );
  }

  const attachable = state.availableGroups.filter((g) => !state.attachedGroups.includes(g.name));

  return (
    <div className="space-y-4">
      {!state.enabled && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-800">
          <ShieldAlert className="size-4" />
          <AlertDescription className="text-amber-800">{t("vmFirewallDisabled")}</AlertDescription>
        </Alert>
      )}

      {/* Security groups */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-neutral-500">{t("sharedGroups")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {state.attachedGroups.map((g) => (
            <Badge key={g} variant="secondary" className="gap-1 bg-blue-50 py-1 pl-2.5 text-blue-700">
              {g}
              {state.availableGroups.some((a) => a.name === g) && (
                <button onClick={() => detachGroup(g)} className="hover:text-red-600">
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          ))}
          {attachable.length > 0 ? (
            <Select onValueChange={attachGroup} value="">
              <SelectTrigger className="h-7 w-44 text-xs">
                <SelectValue placeholder={t("attachGroup")} />
              </SelectTrigger>
              <SelectContent>
                {attachable.map((g) => (
                  <SelectItem key={g.name} value={g.name}>
                    {g.name}
                    {g.description ? ` — ${localized(g.description, locale)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            state.attachedGroups.length === 0 && (
              <span className="text-xs text-neutral-400">{t("noSharedGroups")}</span>
            )
          )}
        </CardContent>
      </Card>

      {/* Rules table */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-sm text-neutral-500">{t("rules")}</CardTitle>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => openAdd("ssh")}>
              {t("presetSsh")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => openAdd("http")}>
              {t("presetHttp")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => openAdd("https")}>
              {t("presetHttps")}
            </Button>
            <Button size="sm" onClick={() => openAdd()}>
              <Plus className="size-3.5" /> {t("addRule")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("direction")}</TableHead>
                <TableHead>{t("action")}</TableHead>
                <TableHead>{t("protocol")}</TableHead>
                <TableHead>{t("portRange")}</TableHead>
                <TableHead>{t("source")}</TableHead>
                <TableHead>{t("comment")}</TableHead>
                <TableHead>{t("enabled")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.rules.map((r) => (
                <TableRow key={r.pos} className={r.locked ? "bg-neutral-50/60" : undefined}>
                  <TableCell>{r.direction === "in" ? t("in") : t("out")}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        r.action === "ACCEPT"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-red-50 text-red-600"
                      }
                    >
                      {r.action === "ACCEPT" ? t("accept") : r.action === "DROP" ? t("drop") : t("reject")}
                    </Badge>
                  </TableCell>
                  <TableCell className="uppercase">{r.proto ?? "—"}</TableCell>
                  <TableCell>{r.dport ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.source ?? "0.0.0.0/0"}</TableCell>
                  <TableCell className="max-w-40 truncate text-xs text-neutral-500">
                    {r.comment ?? ""}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-block size-2 rounded-full ${r.enabled ? "bg-emerald-500" : "bg-neutral-300"}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    {r.locked ? (
                      <Tooltip>
                        <TooltipTrigger>
                          <Badge variant="outline" className="gap-1 text-[10px] text-neutral-400">
                            <Lock className="size-3" /> {t("managedByAdmin")}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>{t("baselineTooltip")}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(r)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-red-500"
                          onClick={() => deleteRule(r.pos)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {state.rules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-neutral-400">
                    {tc("empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add / Edit rule dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editPos === null ? t("addRule") : t("editRule")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("direction")}>
              <Select
                value={rule.direction}
                onValueChange={(v) => setRule({ ...rule, direction: v as "in" | "out" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">{t("in")}</SelectItem>
                  <SelectItem value="out">{t("out")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("action")}>
              <Select
                value={rule.action}
                onValueChange={(v) => setRule({ ...rule, action: v as typeof rule.action })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACCEPT">{t("accept")}</SelectItem>
                  <SelectItem value="DROP">{t("drop")}</SelectItem>
                  <SelectItem value="REJECT">{t("reject")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("protocol")}>
              <Select
                value={rule.proto ?? "any"}
                onValueChange={(v) => setRule({ ...rule, proto: v === "any" ? null : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="tcp">TCP</SelectItem>
                  <SelectItem value="udp">UDP</SelectItem>
                  <SelectItem value="icmp">ICMP</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("portRange")}>
              <Input
                value={rule.dport}
                placeholder="80 / 8000:8080"
                disabled={!rule.proto || rule.proto === "icmp"}
                onChange={(e) => setRule({ ...rule, dport: e.target.value })}
              />
            </Field>
            <Field label={t("source")} hint={t("cidrHint")}>
              <Input
                value={rule.source}
                placeholder="0.0.0.0/0"
                onChange={(e) => setRule({ ...rule, source: e.target.value })}
              />
            </Field>
            <Field label={t("dest")} hint={t("cidrHint")}>
              <Input
                value={rule.dest}
                placeholder="0.0.0.0/0"
                onChange={(e) => setRule({ ...rule, dest: e.target.value })}
              />
            </Field>
            <div className="col-span-2">
              <Field label={t("comment")}>
                <Input
                  value={rule.comment}
                  maxLength={120}
                  onChange={(e) => setRule({ ...rule, comment: e.target.value })}
                />
              </Field>
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <Switch checked={rule.enable} onCheckedChange={(v) => setRule({ ...rule, enable: v })} />
              {t("enabled")}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button disabled={busy} onClick={saveRule}>
              {tc("save")}
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
