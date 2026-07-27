import { NextRequest } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { api, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";
import { rpConfig, setChallengeCookie } from "@/lib/webauthn";
import { ADMIN_ROLES } from "@/auth";

/** Step 1 of passkey login: issue authentication options for an admin email. */
export const POST = api(async (req: NextRequest) => {
  rateLimit("passkey", clientIp(req), LIMITS.passkey.max, LIMITS.passkey.windowMs);
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return json({ error: { code: "bad_request" } }, 400);

  const user = await prisma.user.findUnique({
    where: { email },
    include: { adminCredential: { include: { webAuthnCredentials: true } } },
  });
  const creds =
    user && ADMIN_ROLES.includes(user.role)
      ? (user.adminCredential?.webAuthnCredentials ?? [])
      : [];

  const { rpID } = rpConfig();
  // Options are returned even for unknown emails (empty allowlist) so the
  // endpoint does not reveal which emails have accounts.
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: creds.map((c) => ({
      id: Buffer.from(c.credentialId, "base64url"),
      type: "public-key" as const,
      transports: c.transports
        ? (c.transports.split(",") as AuthenticatorTransport[])
        : undefined,
    })),
  });

  const res = json(options);
  setChallengeCookie(res, { challenge: options.challenge, purpose: "login", subject: email });
  return res;
});
