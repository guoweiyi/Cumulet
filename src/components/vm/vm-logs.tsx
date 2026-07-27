"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";

type LogEntry = { id: string; action: string; createdAt: string; actor: string | null };

export function VmLogs({ bindingId }: { bindingId: string }) {
  const t = useTranslations("vm");
  const locale = useLocale();
  const [logs, setLogs] = useState<LogEntry[] | null>(null);

  useEffect(() => {
    fetch(`/api/vms/${bindingId}/logs`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { logs: [] }))
      .then((d) => setLogs(d.logs ?? []));
  }, [bindingId]);

  return (
    <Card>
      <CardContent className="p-0">
        {!logs || logs.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-400">{t("logsEmpty")}</p>
        ) : (
          <ul className="divide-y">
            {logs.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <code className="text-xs text-blue-700">{l.action}</code>
                <span className="text-xs text-neutral-500">{l.actor}</span>
                <span className="ml-auto text-xs text-neutral-400">
                  {new Date(l.createdAt).toLocaleString(locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
