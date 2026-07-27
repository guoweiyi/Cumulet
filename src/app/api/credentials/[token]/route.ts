import { NextRequest } from "next/server";
import { api, json, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { decryptSecret, hashToken } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ token: string }> };

/**
 * Consume a one-time credential token. Public route (the link is the secret):
 * atomically mark consumed so it can only ever be read once, then return the
 * decrypted payload. Rate-limited per IP to blunt token guessing.
 */
export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  rateLimit("credentialView", clientIp(req), LIMITS.credentialView.max, LIMITS.credentialView.windowMs);
  const { token } = await ctx.params;
  if (!token || token.length < 20) throw notFound();

  const tokenHash = hashToken(token);
  // Atomic single-consume: only the first caller flips consumedAt.
  const claim = await prisma.oneTimeCredential.updateMany({
    where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (claim.count === 0) throw notFound();

  const record = await prisma.oneTimeCredential.findUnique({ where: { tokenHash } });
  if (!record) throw notFound();

  let payload: Record<string, string>;
  try {
    payload = JSON.parse(decryptSecret(record.payloadEnc));
  } catch {
    throw notFound();
  }
  await audit({
    actorId: null,
    action: "credentials.viewed",
    targetType: "ResourceBinding",
    targetId: record.bindingId,
  });
  // Payload is deleted from storage now that it's been shown once.
  await prisma.oneTimeCredential.update({
    where: { tokenHash },
    data: { payloadEnc: "" },
  });
  return json({ credentials: payload });
});
