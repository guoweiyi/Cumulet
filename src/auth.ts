import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyPayload } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { trustedOidcEmail } from "@/lib/auth-policy";
import { getEffectiveOidcSettings } from "@/lib/settings";
import type { Role } from "@prisma/client";

export const ADMIN_ROLES: Role[] = ["AUDITOR", "ADMIN", "SUPER_ADMIN"];

/** Single-use guard for passkey hand-off tokens (in-process; monolith). */
const usedJtis = new Map<string, number>();
function jtiSeen(jti: string): boolean {
  const now = Date.now();
  for (const [k, exp] of usedJtis) if (exp < now) usedJtis.delete(k);
  if (usedJtis.has(jti)) return true;
  usedJtis.set(jti, now + 5 * 60_000);
  return false;
}

async function refreshClaims(uid: string) {
  const u = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true, role: true, realName: true, studentId: true, email: true },
  });
  if (!u) return null;
  return {
    role: u.role,
    needsOnboarding: u.realName === null || u.studentId === null,
    email: u.email,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(async (): Promise<NextAuthConfig> => {
  const oidc = await getEffectiveOidcSettings();
  const oidcEnabled = Boolean(
    oidc?.enabled && oidc.issuer && oidc.clientId && oidc.clientSecret,
  );
  return {
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    // Client portal SSO (e.g. Casdoor). User is upserted on first login.
    ...(oidcEnabled ? [{
      id: "oidc",
      name: oidc!.providerName,
      type: "oidc" as const,
      issuer: oidc!.issuer,
      clientId: oidc!.clientId,
      clientSecret: oidc!.clientSecret,
      checks: ["pkce", "state", "nonce"] as ("pkce" | "state" | "nonce")[],
      profile(profile: Record<string, unknown>) {
        return {
          id: String(profile.sub),
          email: profile.email as string | undefined,
          name:
            (profile.name as string | undefined) ??
            (profile.preferred_username as string | undefined) ??
            (profile.nickname as string | undefined),
        };
      },
    }] : []),
    // Admin portal: email + password (argon2/bcrypt hash, lockout on failures).
    Credentials({
      id: "admin-password",
      name: "Admin Password",
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const email = typeof creds?.email === "string" ? creds.email.trim().toLowerCase() : "";
        const password = typeof creds?.password === "string" ? creds.password : "";
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          include: { adminCredential: true },
        });
        // Uniform failure path — no user-enumeration signal.
        if (!user || !ADMIN_ROLES.includes(user.role) || !user.adminCredential?.passwordHash) {
          await bcrypt.compare(password, "$2a$12$invalidsaltinvalidsaltinvalidsaltinvalid");
          return null;
        }
        const cred = user.adminCredential;
        if (cred.lockedUntil && cred.lockedUntil > new Date()) {
          await audit({ actorId: user.id, action: "auth.admin.locked_attempt" });
          return null;
        }
        const ok = await bcrypt.compare(password, cred.passwordHash!);
        if (!ok) {
          const failed = cred.failedLoginCount + 1;
          await prisma.adminCredential.update({
            where: { id: cred.id },
            data: {
              failedLoginCount: failed,
              lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60_000) : null,
            },
          });
          await audit({ actorId: user.id, action: "auth.admin.password_failed" });
          return null;
        }
        await prisma.adminCredential.update({
          where: { id: cred.id },
          data: { failedLoginCount: 0, lockedUntil: null },
        });
        await audit({ actorId: user.id, action: "auth.admin.password_login" });
        return { id: user.id, email: user.email, name: user.nickname };
      },
    }),
    // Admin portal: passkey. The WebAuthn ceremony happens in
    // /api/auth/passkey/*; on success those routes mint a short-lived signed
    // single-use token which this provider exchanges for a session.
    Credentials({
      id: "passkey",
      name: "Passkey",
      credentials: { token: {} },
      async authorize(creds) {
        const raw = typeof creds?.token === "string" ? creds.token : "";
        const payload = verifyPayload<{ purpose: string; uid: string; jti: string }>(raw);
        if (!payload || payload.purpose !== "passkey-login" || jtiSeen(payload.jti)) return null;
        const user = await prisma.user.findUnique({ where: { id: payload.uid } });
        if (!user || !ADMIN_ROLES.includes(user.role)) return null;
        await audit({ actorId: user.id, action: "auth.admin.passkey_login" });
        return { id: user.id, email: user.email, name: user.nickname };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "oidc") {
        // Email links local identities and JumpServer permissions. Requiring the
        // standard verified claim prevents account takeover through a weak IdP
        // configuration or an unverified address.
        if (!trustedOidcEmail(profile)) return false;
      }
      return true;
    },
    async jwt({ token, user, account, profile, trigger }) {
      // Initial sign-in
      if (account) {
        if (account.provider === "oidc") {
          const sub = account.providerAccountId;
          const email = trustedOidcEmail(profile);
          if (!email) return null;
          const nickname =
            (profile?.name as string | undefined) ??
            (profile?.preferred_username as string | undefined) ??
            email.split("@")[0];
          let dbUser = await prisma.user.findUnique({ where: { oidcSub: sub } });
          if (!dbUser) {
            const byEmail = await prisma.user.findUnique({ where: { email } });
            dbUser = byEmail
              ? await prisma.user.update({ where: { id: byEmail.id }, data: { oidcSub: sub, nickname: byEmail.nickname ?? nickname } })
              : await prisma.user.create({ data: { oidcSub: sub, email, nickname, role: "USER" } });
            await audit({ actorId: dbUser.id, action: "auth.oidc.first_login" });
          } else if (dbUser.email !== email) {
            dbUser = await prisma.user.update({ where: { id: dbUser.id }, data: { email } });
          }
          token.uid = dbUser.id;
        } else if (user?.id) {
          token.uid = user.id;
        }
        if (token.uid) {
          const claims = await refreshClaims(token.uid);
          if (claims) {
            token.role = claims.role;
            token.needsOnboarding = claims.needsOnboarding;
            token.email = claims.email;
          }
          token.fresh = Date.now();
        }
        return token;
      }
      // Refresh role/onboarding claims at most once a minute (or on update()).
      if (token.uid && (trigger === "update" || !token.fresh || Date.now() - token.fresh > 60_000)) {
        const claims = await refreshClaims(token.uid);
        if (!claims) return null; // user deleted — kill session
        token.role = claims.role;
        token.needsOnboarding = claims.needsOnboarding;
        token.email = claims.email;
        token.fresh = Date.now();
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) {
        session.user.id = token.uid;
        session.user.role = token.role ?? "USER";
        session.user.needsOnboarding = token.needsOnboarding ?? false;
        if (token.email) session.user.email = token.email;
      }
      return session;
    },
  },
  };
});
