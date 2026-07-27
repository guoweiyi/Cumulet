"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

export function ResizeDialog({
  bindingId,
  current,
  quota,
  onDone,
}: {
  bindingId: string;
  current: { cores: number; ramMb: number; diskGb: number };
  quota: { maxCpuCores: number; maxRamGB: number; maxDiskGB: number };
  onDone: () => void;
}) {
  const t = useTranslations("vm");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [cores, setCores] = useState(current.cores);
  const [ramMb, setRamMb] = useState(current.ramMb);
  const [diskGb, setDiskGb] = useState(current.diskGb);
  const [busy, setBusy] = useState(false);

  function reset() {
    setCores(current.cores);
    setRamMb(current.ramMb);
    setDiskGb(current.diskGb);
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(`/api/vms/${bindingId}/resize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cores, ramMb, diskGb }),
      });
      if (res.status === 422) {
        toast.error(t("resizeOverQuota"));
        return;
      }
      if (res.status === 409) {
        toast.error(t("resizeHint"));
        return;
      }
      if (!res.ok) {
        toast.error(tc("requestFailed"));
        return;
      }
      const data = await res.json();
      toast.success(t("resizeSubmitted") + (data.rebootRequired ? ` — ${t("rebootRequired")}` : ""));
      setOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Settings2 className="size-3.5" /> {t("resize")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("resizeTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-neutral-500">{t("resizeHint")}</p>
          <div className="space-y-5 py-2">
            <SliderRow
              label={`${t("cpu")}: ${cores} ${t("cores")}`}
              value={cores}
              min={1}
              max={quota.maxCpuCores}
              step={1}
              onChange={setCores}
            />
            <SliderRow
              label={`${t("ram")}: ${ramMb >= 1024 ? `${ramMb / 1024} GB` : `${ramMb} MB`}`}
              value={ramMb}
              min={1024}
              max={quota.maxRamGB * 1024}
              step={1024}
              onChange={setRamMb}
            />
            <SliderRow
              label={`${t("disk")}: ${diskGb} GB`}
              value={diskGb}
              min={current.diskGb}
              max={Math.max(quota.maxDiskGB, current.diskGb)}
              step={10}
              onChange={setDiskGb}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button disabled={busy} onClick={submit}>
              {tc("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm">{label}</Label>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}
