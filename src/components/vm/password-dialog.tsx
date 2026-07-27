"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function PasswordResetDialog({ bindingId }: { bindingId: string }) {
  const t = useTranslations("vm");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reset() {
    setBusy(true);
    try {
      const res = await fetch(`/api/vms/${bindingId}/password`, { method: "POST" });
      if (res.status === 429) {
        toast.error(tc("rateLimited"));
        return;
      }
      if (!res.ok) {
        toast.error(tc("requestFailed"));
        return;
      }
      const data = await res.json();
      setPassword(data.password);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <KeyRound className="size-3.5" /> {t("resetPassword")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setPassword(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("resetPasswordTitle")}</DialogTitle>
          </DialogHeader>
          {password === null ? (
            <>
              <p className="text-sm text-neutral-600">{t("resetPasswordHint")}</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {tc("cancel")}
                </Button>
                <Button disabled={busy} onClick={reset}>
                  {tc("confirm")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <p className="text-sm text-emerald-700">{t("passwordResetDone")}</p>
              <div className="flex items-center gap-2 rounded-lg border bg-neutral-50 p-3">
                <code className="flex-1 text-sm font-semibold tracking-wide">{password}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(password);
                    toast.success(tc("copied"));
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>{tc("close")}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
