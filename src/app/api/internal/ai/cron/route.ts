import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { api, json, unauthorized } from "@/lib/api";
import { runScheduledAiInspections } from "@/lib/ai";

function validToken(req: NextRequest): boolean {
  const expected = process.env.INTERNAL_CRON_TOKEN;
  const presented = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !presented) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const POST = api(async (req: NextRequest) => {
  if (!validToken(req)) throw unauthorized();
  const holderId = req.headers.get("x-cumulet-worker")?.slice(0, 64) || "internal";
  return json(await runScheduledAiInspections(holderId));
});
