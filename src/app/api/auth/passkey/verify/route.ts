import { NextRequest } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/types";
import { api, badRequest, json, unauthorized } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { randomToken, signPayload } from "@/lib/crypto";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";
import { clearChallengeCookie, readChallengeCookie, rpConfig } from "@/lib/webauthn";
import { ADMIN_ROLES } from "@/auth";

/**
 * Step 2 of passkey login: verify the assertion; on success return a
 * short-lived single-use token consumed by signIn("passkey").
 */
export const POST = api(async (req: NextRequest) => {
  rateLimit("passkey", clientIp(req), LIMITS.passkey.max, LIMITS.passkey.windowMs);
  const ctx = readChallengeCookie(req, "login");
  if (!ctx) throw badRequest("challenge_expired");

  const body = (await req.json().catch(() => null)) as {
    assertion?: AuthenticationResponseJSON;
  } | null;
  if (!body?.assertion?.id) throw badRequest();

  const credential = await prisma.webAuthnCredential.findUnique({
    where: { credentialId: body.assertion.id },
    include: { adminCredential: { include: { user: true } } },
  });
  const user = credential?.adminCredential.user;
  if (
    !credential ||
    !user ||
    !ADMIN_ROLES.includes(user.role) ||
    user.email.toLowerCase() !== ctx.subject
  ) {
    throw unauthorized();
  }

  const { rpID, origin } = rpConfig();
  const result = await verifyAuthenticationResponse({
    response: body.assertion,
    expectedChallenge: ctx.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    authenticator: {
      credentialID: new Uint8Array(Buffer.from(credential.credentialId, "base64url")),
      credentialPublicKey: new Uint8Array(credential.publicKey),
      counter: Number(credential.counter),
    },
  });
  if (!result.verified) throw unauthorized();

  await prisma.webAuthnCredential.update({
    where: { id: credential.id },
    data: { counter: BigInt(result.authenticationInfo.newCounter), lastUsedAt: new Date() },
  });

  const token = signPayload(
    { purpose: "passkey-login", uid: user.id, jti: randomToken(16) },
    60,
  );
  const res = json({ token });
  clearChallengeCookie(res);
  return res;
});
