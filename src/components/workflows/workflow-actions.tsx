"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, CopyPlus, Plus, Trash2 } from "lucide-react";
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

export function NewWorkflowButton() {
  const t = useTranslations("admin.workflow");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [resourceType, setResourceType] = useState("vm");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: { zh: name }, resourceType }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.schema?.id) return toast.error(tc("requestFailed"));
      router.push(`/admin/workflows/${data.schema.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus className="size-4" />{t("new")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("new")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>{t("name")}</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div>
            <div className="space-y-1.5"><Label>{t("resourceType")}</Label><Input value={resourceType} onChange={(event) => setResourceType(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{tc("cancel")}</Button>
            <Button disabled={busy || !name.trim() || !resourceType} onClick={create}>{tc("create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WorkflowActions({
  id,
  status,
  active,
  canWrite,
  hasDraft,
  deletable,
}: {
  id: string;
  status: string;
  active: boolean;
  canWrite: boolean;
  hasDraft: boolean;
  deletable: boolean;
}) {
  const t = useTranslations("admin.workflow");
  const tc = useTranslations("common");
  const router = useRouter();
  if (!canWrite) return null;

  async function post(action: string) {
    const response = await fetch(`/api/admin/workflows/${id}/${action}`, { method: "POST" });
    const data = await response.json().catch(() => null);
    if (!response.ok) return toast.error(data?.error?.message ?? tc("requestFailed"));
    if (data?.schema?.id) router.push(`/admin/workflows/${data.schema.id}`);
    else router.refresh();
  }

  async function remove() {
    if (!confirm(tc("confirm") + "?")) return;
    const response = await fetch(`/api/admin/workflows/${id}`, { method: "DELETE" });
    if (!response.ok) return toast.error(tc("requestFailed"));
    router.refresh();
  }

  return (
    <div className="ml-auto flex items-center gap-1">
      {status !== "DRAFT" && !hasDraft && <Button size="sm" variant="ghost" title={t("newVersion")} onClick={() => post("new-version")}><CopyPlus className="size-4" /></Button>}
      {status === "PUBLISHED" && !active && <Button size="sm" variant="ghost" title={t("activate")} onClick={() => post("activate")}><CheckCircle2 className="size-4" /></Button>}
      {deletable && <Button size="sm" variant="ghost" className="text-red-600" title={tc("delete")} onClick={remove}><Trash2 className="size-4" /></Button>}
    </div>
  );
}
