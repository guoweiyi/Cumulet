"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ResizeRequestActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function decide(action: "approve" | "reject") {
    const reason = action === "reject"
      ? window.prompt("请输入驳回原因（可选）") ?? undefined
      : undefined;
    if (action === "reject" && reason === undefined) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/resize-requests/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) {
        toast.error("操作失败，请检查资源状态和供应商连接");
        return;
      }
      toast.success(action === "approve" ? "配置已审批并应用" : "申请已驳回");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("reject")}>
        <X className="size-4" /> 驳回
      </Button>
      <Button size="sm" disabled={busy} onClick={() => decide("approve")}>
        <Check className="size-4" /> 批准并应用
      </Button>
    </div>
  );
}
