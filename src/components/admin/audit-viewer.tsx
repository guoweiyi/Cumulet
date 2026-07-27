"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Log = {
  id: string;
  action: string;
  actor: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
};

export function AuditViewer() {
  const t = useTranslations("admin.audit");
  const locale = useLocale();
  const [logs, setLogs] = useState<Log[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(
    async (reset: boolean) => {
      const params = new URLSearchParams();
      if (filter) params.set("action", filter);
      if (!reset && cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/admin/audit?${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setLogs((prev) => (reset ? data.logs : [...prev, ...data.logs]));
        setCursor(data.nextCursor);
      }
    },
    [cursor, filter],
  );

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <Input
          className="max-w-xs"
          placeholder={t("action")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("time")}</TableHead>
                <TableHead>{t("actor")}</TableHead>
                <TableHead>{t("action")}</TableHead>
                <TableHead>{t("target")}</TableHead>
                <TableHead>{t("metadata")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-xs text-neutral-400">
                    {new Date(l.createdAt).toLocaleString(locale)}
                  </TableCell>
                  <TableCell className="text-sm">{l.actor ?? t("system")}</TableCell>
                  <TableCell>
                    <code className="text-xs text-blue-700">{l.action}</code>
                  </TableCell>
                  <TableCell className="text-xs text-neutral-500">
                    {l.targetType ? `${l.targetType}:${(l.targetId ?? "").slice(-8)}` : "—"}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-neutral-400">
                    {l.metadata ? JSON.stringify(l.metadata) : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {cursor && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => load(false)}>
            {t("title")} +
          </Button>
        </div>
      )}
    </div>
  );
}
