"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Lock, SendHorizonal } from "lucide-react";
import { localized } from "@/i18n/config";
import type { TicketDetailData } from "@/lib/ticket-data";
import { STATUS_BADGE } from "@/components/ticket-status";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

const SYSTEM_EVENT_KEYS = ["approved", "rejected", "provisioned", "provisionFailed", "closed"];

/**
 * Chat-style ticket view shared by the portal and admin pages.
 * `isAdmin` enables internal notes; `adminActions` slots in approve/reject UI.
 */
export function TicketDetail({
  initial,
  isAdmin,
  canWrite,
  adminActions,
  pipelinePanel,
}: {
  initial: TicketDetailData;
  isAdmin: boolean;
  canWrite: boolean;
  adminActions?: (ticket: TicketDetailData, reload: () => void) => React.ReactNode;
  pipelinePanel?: (ticket: TicketDetailData, reload: () => void) => React.ReactNode;
}) {
  const t = useTranslations("ticket");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [ticket, setTicket] = useState(initial);
  const [draft, setDraft] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/tickets/${initial.id}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setTicket(data.ticket);
    }
  }, [initial.id]);

  // Light polling keeps the conversation and pipeline fresh.
  useEffect(() => {
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 8000);
    return () => clearInterval(iv);
  }, [reload]);

  async function send() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft, isInternalNote: internal }),
      });
      if (!res.ok) {
        toast.error(tc("requestFailed"));
        return;
      }
      setDraft("");
      await reload();
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  }

  const closed = ["CLOSED", "REJECTED"].includes(ticket.status);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      {/* Timeline column */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">
            {t("ticketId")} #{ticket.id.slice(-8)}
          </h1>
          <Badge variant="secondary" className={STATUS_BADGE[ticket.status]}>
            {t(`status.${ticket.status}`)}
          </Badge>
          {isAdmin && ticket.requester && (
            <span className="text-sm text-neutral-500">
              {ticket.requester.realName ?? ticket.requester.nickname} · {ticket.requester.email}
            </span>
          )}
          <div className="flex-1" />
          {adminActions?.(ticket, reload)}
        </div>

        {pipelinePanel?.(ticket, reload)}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-neutral-500">{t("timeline")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {ticket.messages.map((m) =>
              m.isSystem ? (
                <div key={m.id} className="flex justify-center">
                  <Badge variant="outline" className="font-normal text-neutral-500">
                    {SYSTEM_EVENT_KEYS.includes(m.body) ? t(`event.${m.body}` as never) : m.body}
                    <span className="ml-1.5 text-[10px] text-neutral-400">
                      {new Date(m.createdAt).toLocaleString(locale)}
                    </span>
                  </Badge>
                </div>
              ) : (
                <div
                  key={m.id}
                  className={cn("flex", m.author?.isAdmin ? "justify-start" : "justify-end")}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg px-3.5 py-2.5 text-sm",
                      m.isInternalNote
                        ? "border border-dashed border-amber-300 bg-amber-50"
                        : m.author?.isAdmin
                          ? "bg-neutral-100"
                          : "bg-blue-600 text-white",
                    )}
                  >
                    <div
                      className={cn(
                        "mb-1 flex items-center gap-2 text-[11px]",
                        m.author?.isAdmin ? "text-neutral-400" : "text-blue-100",
                      )}
                    >
                      {m.author?.name}
                      {m.isInternalNote && (
                        <Badge variant="outline" className="border-amber-400 text-[9px] text-amber-600">
                          <Lock className="mr-0.5 size-2.5" />
                          {t("internalNoteBadge")}
                        </Badge>
                      )}
                      <span>{new Date(m.createdAt).toLocaleString(locale)}</span>
                    </div>
                    <p className={cn("whitespace-pre-wrap break-words", m.isInternalNote && "text-amber-900")}>
                      {m.body}
                    </p>
                  </div>
                </div>
              ),
            )}
            <div ref={bottomRef} />

            {canWrite && !closed && (
              <div className="space-y-2 border-t pt-3">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t("messagePlaceholder")}
                  rows={3}
                  maxLength={5000}
                />
                <div className="flex items-center gap-3">
                  {isAdmin && (
                    <label className="flex items-center gap-2 text-xs text-neutral-500">
                      <Checkbox checked={internal} onCheckedChange={(v) => setInternal(v === true)} />
                      {t("internalNote")}
                    </label>
                  )}
                  <div className="flex-1" />
                  <Button size="sm" disabled={busy || !draft.trim()} onClick={send}>
                    <SendHorizonal className="size-3.5" /> {t("send")}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Config summary column */}
      <Card className="h-fit lg:sticky lg:top-16">
        <CardHeader>
          <CardTitle className="text-sm text-neutral-500">{t("configSummary")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm font-medium">
            {localized(ticket.formName, locale)}{" "}
            <span className="text-xs font-normal text-neutral-400">v{ticket.formVersion}</span>
          </p>
          <dl className="space-y-2 text-sm">
            {ticket.definition.fields
              .filter((f) => ticket.values[f.id] !== undefined)
              .map((f) => {
                const v = ticket.values[f.id];
                const opt = f.props?.options?.find((o) => o.value === v);
                const display = opt
                  ? localized(opt.label, locale)
                  : v === true
                    ? tc("yes")
                    : v === false
                      ? tc("no")
                      : String(v);
                return (
                  <div key={f.id} className="flex justify-between gap-3 border-b border-dashed pb-1.5">
                    <dt className="text-muted-foreground">{localized(f.label, locale)}</dt>
                    <dd className="text-right font-medium">{display}</dd>
                  </div>
                );
              })}
          </dl>
          {ticket.binding && (
            <div className="mt-4 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">
              <p>VMID: {ticket.binding.vmid}</p>
              <p>IP: {ticket.binding.internalIp}</p>
              <p>AZ: {ticket.binding.nodeName}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
