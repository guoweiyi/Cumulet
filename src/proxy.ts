import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

// Proxy always runs on the Node.js runtime in Next.js 16 — no `runtime` config.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webp)$).*)"],
};

const ADMIN_ROLES = ["AUDITOR", "ADMIN", "SUPER_ADMIN"];

// Coarse route gating only. Authoritative RBAC + ownership checks live in
// route handlers / server components via lib/guards.ts (DB-backed).
// (Next.js 16 renamed the `middleware` file convention to `proxy`.)
export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname === "/admin/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/health" ||
    pathname === "/api/internal/ai/cron" ||
    pathname === "/api/internal/lifecycle/cron" ||
    pathname.startsWith("/credentials/") ||
    pathname.startsWith("/api/credentials/");
  if (isPublic) return NextResponse.next();

  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const configuredProtocol = (() => {
    try { return new URL(process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? req.url).protocol; }
    catch { return req.nextUrl.protocol; }
  })();
  const secure = forwardedProto === "https" || configuredProtocol === "https:" || req.nextUrl.protocol === "https:";
  const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";
  const token = await getToken({
    req,
    secret: (process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET)!,
    cookieName,
    salt: cookieName,
    secureCookie: secure,
  }).catch(() => null);

  const isApi = pathname.startsWith("/api/");
  const isAdminArea = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");

  if (!token?.uid) {
    if (isApi) {
      return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
    }
    const login = req.nextUrl.clone();
    login.pathname = isAdminArea ? "/admin/login" : "/login";
    login.search = "";
    login.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(login);
  }

  if (isAdminArea && !ADMIN_ROLES.includes(String(token.role))) {
    if (isApi) {
      return NextResponse.json({ error: { code: "forbidden" } }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/", req.url));
  }

  // One-time identity onboarding gate for the client portal.
  if (!isApi && !isAdminArea) {
    if (token.needsOnboarding && pathname !== "/onboarding") {
      return NextResponse.redirect(new URL("/onboarding", req.url));
    }
    if (!token.needsOnboarding && pathname === "/onboarding") {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  return NextResponse.next();
}
