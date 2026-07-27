import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { api, json, unauthorized } from "@/lib/api";
import { runResourceLifecycle } from "@/lib/lifecycle";
import { retryPendingWebhookDeliveries } from "@/lib/webhooks";

function validToken(req: NextRequest): boolean {
  const expected = process.env.INTERNAL_CRON_TOKEN;
  const presented = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !presented) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(presented);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const POST = api(async (req: NextRequest) => {
  if (!validToken(req)) throw unauthorized();
  const holderId = req.headers.get("x-cumulet-worker")?.slice(0, 64) || "internal";
  const [lifecycle, webhooks] = await Promise.all([
    runResourceLifecycle(holderId),
    retryPendingWebhookDeliveries(),
  ]);
  return json({ lifecycle, webhooks });
});

