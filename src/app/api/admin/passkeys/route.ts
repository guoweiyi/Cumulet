import { NextRequest } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/types";
import { api, badRequest, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { clearChallengeCookie, readChallengeCookie, rpConfig } from "@/lib/webauthn";

export const GET = api(async () => {
  const user = await requireAdmin();
  const creds = await prisma.webAuthnCredential.findMany({
    where: { adminCredential: { userId: user.id } },
    select: { id: true, label: true, deviceType: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });
  return json({ passkeys: creds });
});

/** Finish passkey registration for the calling admin. */
export const POST = api(async (req: NextRequest) => {
  const user = await requireAdmin();
  const ctx = readChallengeCookie(req, "register");
  if (!ctx || ctx.subject !== user.id) throw badRequest("challenge_expired");

  const body = (await req.json().catch(() => null)) as {
    attestation?: RegistrationResponseJSON;
    label?: string;
  } | null;
  if (!body?.attestation) throw badRequest();

  const { rpID, origin } = rpConfig();
  const result = await verifyRegistrationResponse({
    response: body.attestation,
    expectedChallenge: ctx.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!result.verified || !result.registrationInfo) throw badRequest("verification_failed");

  const info = result.registrationInfo;
  const credentialId = Buffer.from(info.credentialID).toString("base64url");
  const adminCred = await prisma.adminCredential.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });
  await prisma.webAuthnCredential.create({
    data: {
      id: credentialId,
      credentialId,
      adminCredId: adminCred.id,
      publicKey: Buffer.from(info.credentialPublicKey),
      counter: BigInt(info.counter),
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      transports: body.attestation.response.transports?.join(","),
      label: typeof body.label === "string" ? body.label.slice(0, 64) : null,
    },
  });
  await audit({ actorId: user.id, action: "auth.passkey.registered", targetId: credentialId });

  const res = json({ ok: true });
  clearChallengeCookie(res);
  return res;
});
