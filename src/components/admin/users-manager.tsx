"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { KeyRound, Loader2, Pencil, SlidersHorizontal, Trash2, UserPlus } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Quota = { maxCpuCores: number; maxRamGB: number; maxDiskGB: number; maxFirewallRules: number };
type UserRow = {
  id: string;
  email: string;
  nickname: string | null;
  realName: string | null;
  role: string;
  preferredLocale: string;
  hasPassword: boolean;
  ticketCount: number;
  resourceCount: number;
  quota: Quota | null;
};

const ROLES = ["USER", "AUDITOR", "ADMIN", "SUPER_ADMIN"] as const;

export function UsersManager({
  canManage,
  canGrantRoles,
}: {
  canManage: boolean;
  canGrantRoles: boolean;
}) {
  const t = useTranslations("admin.user");
  const tc = useTranslations("common");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [defaultQuota, setDefaultQuota] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(true);
  const [quotaUser, setQuotaUser] = useState<UserRow | null>(null);
  const [pwUser, setPwUser] = useState<UserRow | null>(null);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users);
      setDefaultQuota(data.defaultQuota);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function send(url: string, method: string, body?: unknown): Promise<boolean> {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const code = data?.error?.message ?? data?.error?.code;
      const map: Record<string, string> = {
        cannot_delete_self: t("cannotDeleteSelf"),
        user_has_resources: t("userHasResources"),
        email_taken: t("emailTaken"),
        realname_immutable: t("realNameImmutable"),
        password_requires_admin_role: t("passwordRequiresAdminRole"),
        weak_password: t("weakPassword"),
        forbidden: tc("forbidden"),
      };
      toast.error(map[code] ?? tc("saveFailed"));
      return false;
    }
    toast.success(tc("saveSuccess"));
    void load();
    return true;
  }

  async function remove(u: UserRow) {
    if (!confirm(t("deleteConfirm", { email: u.email }))) return;
    await send(`/api/admin/users/${u.id}`, "DELETE");
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus className="size-4" /> {t("newUser")}
          </Button>
        )}
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc("name")}</TableHead>
                <TableHead>{t("realName")}</TableHead>
                <TableHead>{t("role")}</TableHead>
                <TableHead>{t("quota")}</TableHead>
                <TableHead>{t("resourcesCol")}</TableHead>
                {canManage && <TableHead>{tc("actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.nickname ?? u.email}</div>
                    <div className="text-xs text-muted-foreground/70">{u.email}</div>
                  </TableCell>
                  <TableCell>{u.realName ?? "—"}</TableCell>
                  <TableCell>
                    {canGrantRoles ? (
                      <Select
                        value={u.role}
                        onValueChange={(v) => {
                          if (confirm(t("roleChangeConfirm", { email: u.email, role: v }))) {
                            void send(`/api/admin/users/${u.id}`, "PATCH", { role: v });
                          }
                        }}
                      >
                        <SelectTrigger className="h-8 w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {t(`roles.${r}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary">{t(`roles.${u.role}` as never)}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="tnum text-xs text-muted-foreground">
                    {u.quota
                      ? `${u.quota.maxCpuCores}C / ${u.quota.maxRamGB}G / ${u.quota.maxDiskGB}G`
                      : tc("none")}
                  </TableCell>
                  <TableCell className="tnum text-xs text-muted-foreground">
                    {u.ticketCount} / {u.resourceCount}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      {(canGrantRoles || u.role === "USER") && <div className="flex gap-0.5">
                        <Button size="icon" variant="ghost" className="size-7" title={t("editUser")} onClick={() => setEditUser(u)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-7" title={t("editQuota")} onClick={() => setQuotaUser(u)}>
                          <SlidersHorizontal className="size-3.5" />
                        </Button>
                        {canGrantRoles && ["ADMIN", "SUPER_ADMIN", "AUDITOR"].includes(u.role) && (
                          <Button size="icon" variant="ghost" className="size-7" title={t("setPassword")} onClick={() => setPwUser(u)}>
                            <KeyRound className="size-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive"
                          title={t("deleteUser")}
                          onClick={() => remove(u)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {createOpen && (
        <UserFormDialog
          mode="create"
          canGrantRoles={canGrantRoles}
          onClose={() => setCreateOpen(false)}
          onSubmit={(body) => send("/api/admin/users", "POST", body).then((ok) => ok && setCreateOpen(false))}
        />
      )}
      {editUser && (
        <UserFormDialog
          mode="edit"
          user={editUser}
          canGrantRoles={canGrantRoles}
          onClose={() => setEditUser(null)}
          onSubmit={(body) => send(`/api/admin/users/${editUser.id}`, "PATCH", body).then((ok) => ok && setEditUser(null))}
        />
      )}
      {quotaUser && defaultQuota && (
        <QuotaDialog
          user={quotaUser}
          defaults={defaultQuota}
          onClose={() => setQuotaUser(null)}
          onSave={(q) => send(`/api/admin/users/${quotaUser.id}`, "PATCH", { quota: q }).then((ok) => ok && setQuotaUser(null))}
        />
      )}
      {pwUser && (
        <PasswordDialog
          user={pwUser}
          onClose={() => setPwUser(null)}
          onSave={(pw) => send(`/api/admin/users/${pwUser.id}`, "PATCH", { password: pw }).then((ok) => ok && setPwUser(null))}
        />
      )}
    </div>
  );
}

function UserFormDialog({
  mode,
  user,
  canGrantRoles,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  user?: UserRow;
  canGrantRoles: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const t = useTranslations("admin.user");
  const tc = useTranslations("common");
  const [form, setForm] = useState({
    email: user?.email ?? "",
    nickname: user?.nickname ?? "",
    realName: user?.realName ?? "",
    role: user?.role ?? "USER",
    preferredLocale: user?.preferredLocale ?? "zh",
    password: "",
  });
  const realNameLocked = mode === "edit" && !!user?.realName;
  const adminRole = form.role !== "USER";

  function submit() {
    const body: Record<string, unknown> = {
      nickname: form.nickname || undefined,
      preferredLocale: form.preferredLocale,
    };
    if (canGrantRoles) body.role = form.role;
    if (mode === "create") body.email = form.email;
    else if (form.email && form.email !== user?.email) body.email = form.email;
    if (!realNameLocked && form.realName) body.realName = form.realName;
    if (form.password) body.password = form.password;
    onSubmit(body);
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? t("newUser") : t("editUser")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t("email")}>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("nickname")}>
              <Input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
            </Field>
            <Field label={t("locale")}>
              <Select value={form.preferredLocale} onValueChange={(v) => setForm({ ...form, preferredLocale: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh">{t("localeZh")}</SelectItem>
                  <SelectItem value="en">{t("localeEn")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={t("realName")} hint={realNameLocked ? undefined : t("realNameLockedHint")}>
            <Input
              value={form.realName}
              disabled={realNameLocked}
              onChange={(e) => setForm({ ...form, realName: e.target.value })}
            />
          </Field>
          {canGrantRoles && <Field label={t("role")}>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{t(`roles.${r}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>}
          {canGrantRoles && adminRole && (
            <Field label={t("passwordOptional")}>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••••" />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tc("cancel")}</Button>
          <Button
            disabled={!form.email.trim() || (!!form.password && form.password.length < 10)}
            onClick={submit}
          >
            {mode === "create" ? t("create") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuotaDialog({
  user,
  defaults,
  onClose,
  onSave,
}: {
  user: UserRow;
  defaults: Quota;
  onClose: () => void;
  onSave: (q: Quota) => void;
}) {
  const t = useTranslations("admin.user");
  const tq = useTranslations("quota");
  const tc = useTranslations("common");
  const [q, setQ] = useState<Quota>(user.quota ?? defaults);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editQuota")} — {user.email}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <QRow label={tq("cpu")} value={q.maxCpuCores} onChange={(v) => setQ({ ...q, maxCpuCores: v })} />
          <QRow label={`${tq("ram")} (GB)`} value={q.maxRamGB} onChange={(v) => setQ({ ...q, maxRamGB: v })} />
          <QRow label={`${tq("disk")} (GB)`} value={q.maxDiskGB} onChange={(v) => setQ({ ...q, maxDiskGB: v })} />
          <QRow label={tq("firewallRules")} value={q.maxFirewallRules} onChange={(v) => setQ({ ...q, maxFirewallRules: v })} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tc("cancel")}</Button>
          <Button onClick={() => onSave(q)}>{tc("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="grid grid-cols-2 items-center gap-3">
      <Label className="text-sm">{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function PasswordDialog({
  user,
  onClose,
  onSave,
}: {
  user: UserRow;
  onClose: () => void;
  onSave: (pw: string) => void;
}) {
  const t = useTranslations("admin.user");
  const tc = useTranslations("common");
  const [pw, setPw] = useState("");
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("setPassword")} — {user.email}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("passwordHint")}</p>
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••••" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tc("cancel")}</Button>
          <Button disabled={pw.length < 10} onClick={() => onSave(pw)}>{tc("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  );
}
