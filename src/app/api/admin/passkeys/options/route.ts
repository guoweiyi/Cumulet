import { generateRegistrationOptions } from "@simplewebauthn/server";
import { api, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { rpConfig, setChallengeCookie } from "@/lib/webauthn";

/** Registration options for adding a passkey to the calling admin's account. */
export const POST = api(async () => {
  const user = await requireAdmin();
  const cred = await prisma.adminCredential.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
    include: { webAuthnCredentials: true },
  });

  const { rpID, rpName } = rpConfig();
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: user.id,
    userName: user.email,
    userDisplayName: user.nickname ?? user.email,
    attestationType: "none",
    excludeCredentials: cred.webAuthnCredentials.map((c) => ({
      id: Buffer.from(c.credentialId, "base64url"),
      type: "public-key" as const,
    })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });

  const res = json(options);
  setChallengeCookie(res, { challenge: options.challenge, purpose: "register", subject: user.id });
  return res;
});
