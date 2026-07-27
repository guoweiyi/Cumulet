"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Loader2, Plus, Trash2 } from "lucide-react";
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

type Passkey = { id: string; label: string | null; deviceType: string | null; createdAt: string; lastUsedAt: string | null };

export function AccountSecurity() {
  const t = useTranslations("admin.profile");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/passkeys", { cache: "no-store" });
    if (res.ok) setPasskeys((await res.json()).passkeys);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function addPasskey() {
    setBusy(true);
    try {
      const optRes = await fetch("/api/admin/passkeys/options", { method: "POST" });
      if (!optRes.ok) throw new Error();
      const options = await optRes.json();
      const attestation = await startRegistration(options);
      const res = await fetch("/api/admin/passkeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attestation, label }),
      });
      if (!res.ok) throw new Error();
      toast.success(tc("saveSuccess"));
      setAddOpen(false);
      setLabel("");
      void load();
    } catch {
      toast.error(tc("requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function deletePasskey(id: string) {
    if (!confirm(tc("confirm") + "?")) return;
    const res = await fetch(`/api/admin/passkeys/${id}`, { method: "DELETE" });
    if (res.ok) void load();
    else toast.error(tc("requestFailed"));
  }

  async function changePassword() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next }),
      });
      if (res.status === 400) {
        toast.error(t("passwordTooWeak"));
        return;
      }
      if (!res.ok) {
        toast.error(tc("requestFailed"));
        return;
      }
      toast.success(t("passwordChanged"));
      setPw({ current: "", next: "" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Fingerprint className="size-4 text-blue-600" />
            {t("passkeys")}
          </CardTitle>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> {t("addPasskey")}
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="mx-auto size-5 animate-spin text-neutral-300" />
          ) : passkeys.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-400">{t("noPasskeys")}</p>
          ) : (
            <ul className="divide-y">
              {passkeys.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <Fingerprint className="size-4 text-neutral-400" />
                  <span className="font-medium">{p.label ?? p.deviceType ?? "Passkey"}</span>
                  {p.lastUsedAt && (
                    <span className="text-xs text-neutral-400">
                      {t("lastUsed")}: {new Date(p.lastUsedAt).toLocaleDateString(locale)}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-7 text-red-500"
                    onClick={() => deletePasskey(p.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("changePassword")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("currentPassword")}</Label>
            <Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("newPassword")}</Label>
            <Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </div>
          <Button disabled={busy || pw.next.length < 10} onClick={changePassword}>
            {tc("save")}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("addPasskey")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{t("passkeyLabel")}</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button disabled={busy} onClick={addPasskey}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {tc("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
