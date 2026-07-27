"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Download, GitBranchPlus, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function NewFormButton() {
  const t = useTranslations("admin.form");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [zh, setZh] = useState("");
  const [en, setEn] = useState("");

  async function create() {
    const res = await fetch("/api/admin/forms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: { zh, en: en || undefined } }),
    });
    if (!res.ok) {
      toast.error(tc("requestFailed"));
      return;
    }
    const { schema } = await res.json();
    router.push(`/admin/forms/${schema.id}`);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" /> {t("newForm")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("newForm")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("formName")} (zh)</Label>
              <Input value={zh} onChange={(e) => setZh(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("formName")} (en)</Label>
              <Input value={en} onChange={(e) => setEn(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{tc("cancel")}</Button>
            <Button disabled={!zh.trim()} onClick={create}>{tc("create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ImportButton() {
  const t = useTranslations("formEngine.list");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setErrors(null);
    setBusy(true);
    try {
      const text = await file.text();
      const res = await fetch(`/api/admin/forms/import?locale=${locale}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      if (res.status === 422) {
        const data = await res.json().catch(() => null);
        setErrors((data?.error?.issues ?? []).map((i: { message: string }) => i.message).slice(0, 8));
        return;
      }
      if (!res.ok) {
        toast.error(tc("requestFailed"));
        return;
      }
      const { schema } = await res.json();
      toast.success(t("importSuccess"));
      router.push(`/admin/forms/${schema.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
      <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
        <Upload className="size-4" /> {t("import")}
      </Button>
      <Dialog open={errors !== null} onOpenChange={(o) => !o && setErrors(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("importInvalid")}</DialogTitle>
          </DialogHeader>
          <ul className="space-y-1 text-sm text-destructive">
            {errors?.map((e, i) => <li key={i}>• {e}</li>)}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setErrors(null)}>{tc("close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function FormRowActions({
  latestId,
  canWrite,
  hasDraft,
}: {
  latestId: string;
  canWrite: boolean;
  hasDraft: boolean;
}) {
  const t = useTranslations("formEngine.list");
  const tf = useTranslations("admin.form");
  const tc = useTranslations("common");
  const router = useRouter();

  async function post(url: string) {
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      toast.error(tc("requestFailed"));
      return;
    }
    const data = await res.json().catch(() => null);
    if (data?.schema?.id) router.push(`/admin/forms/${data.schema.id}`);
    else router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">{tc("actions")}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={`/api/admin/forms/${latestId}/export`} download>
            <Download className="size-4" /> {t("export")}
          </a>
        </DropdownMenuItem>
        {canWrite && (
          <DropdownMenuItem onClick={() => post(`/api/admin/forms/${latestId}/duplicate`)}>
            <Copy className="size-4" /> {t("duplicate")}
          </DropdownMenuItem>
        )}
        {canWrite && !hasDraft && (
          <DropdownMenuItem onClick={() => post(`/api/admin/forms/${latestId}/new-version`)}>
            <GitBranchPlus className="size-4" /> {tf("newVersion")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
