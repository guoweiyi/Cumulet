import { NextRequest } from "next/server";
import { api, json } from "@/lib/api";
import { mapPveError, vmContext } from "@/lib/vm";

type Ctx = { params: Promise<{ id: string }> };

/** RRD chart data. ?timeframe=hour|day|week */
export const GET = api<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const { binding, client } = await vmContext(id);
  const tf = req.nextUrl.searchParams.get("timeframe");
  const timeframe = tf === "day" || tf === "week" ? tf : "hour";
  try {
    const data = await client.rrdData(binding.vmid, timeframe);
    return json({
      points: data.map((p) => ({
        time: p.time,
        cpu: p.cpu ?? null,
        mem: p.mem ?? null,
        maxmem: p.maxmem ?? null,
        netin: p.netin ?? null,
        netout: p.netout ?? null,
      })),
    });
  } catch (err) {
    mapPveError(err);
  }
});
