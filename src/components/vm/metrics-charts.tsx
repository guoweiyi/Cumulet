"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

type Point = {
  time: number;
  cpu: number | null;
  mem: number | null;
  maxmem: number | null;
  netin: number | null;
  netout: number | null;
};

const TIMEFRAMES = ["hour", "day", "week"] as const;
const RANGE_KEY: Record<(typeof TIMEFRAMES)[number], "realtime" | "day" | "week"> = {
  hour: "realtime",
  day: "day",
  week: "week",
};

export function MetricsCharts({ bindingId }: { bindingId: string }) {
  const t = useTranslations("vm");
  const [tf, setTf] = useState<(typeof TIMEFRAMES)[number]>("hour");
  const [points, setPoints] = useState<Point[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/vms/${bindingId}/metrics?timeframe=${tf}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setPoints(data.points ?? []);
    }
  }, [bindingId, tf]);

  useEffect(() => {
    void load();
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => clearInterval(iv);
  }, [load]);

  const chartData = points.map((p) => ({
    t: new Date(p.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    cpu: p.cpu !== null ? Math.round(p.cpu * 1000) / 10 : null,
    mem: p.mem !== null && p.maxmem ? Math.round((p.mem / p.maxmem) * 1000) / 10 : null,
    netin: p.netin !== null ? Math.round((p.netin / 1024) * 10) / 10 : null,
    netout: p.netout !== null ? Math.round((p.netout / 1024) * 10) / 10 : null,
  }));

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {TIMEFRAMES.map((f) => (
          <button
            key={f}
            onClick={() => setTf(f)}
            className={cn(
              "rounded-full px-3 py-1 text-xs",
              tf === f ? "bg-blue-600 text-white" : "text-neutral-500 hover:bg-neutral-100",
            )}
          >
            {t(`range.${RANGE_KEY[f]}`)}
          </button>
        ))}
      </div>
      <Chart title={`${t("cpuUsage")} (%)`} data={chartData} keys={["cpu"]} colors={["#2563eb"]} />
      <Chart title={`${t("ramUsage")} (%)`} data={chartData} keys={["mem"]} colors={["#7c3aed"]} />
      <Chart
        title={`${t("netIn")} / ${t("netOut")} (KB/s)`}
        data={chartData}
        keys={["netin", "netout"]}
        colors={["#0891b2", "#f59e0b"]}
      />
    </div>
  );
}

function Chart({
  title,
  data,
  keys,
  colors,
}: {
  title: string;
  data: Record<string, unknown>[];
  keys: string[];
  colors: string[];
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-neutral-500">{title}</p>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f3f3" />
            <XAxis dataKey="t" tick={{ fontSize: 9 }} interval="preserveStartEnd" minTickGap={40} />
            <YAxis tick={{ fontSize: 9 }} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            {keys.map((k, i) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                stroke={colors[i]}
                fill={colors[i]}
                fillOpacity={0.12}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
