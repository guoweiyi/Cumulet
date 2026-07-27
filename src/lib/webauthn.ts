import type { NextRequest, NextResponse } from "next/server";
import { signPayload, verifyPayload } from "./crypto";

export function rpConfig() {
  const url = new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000");
  return { rpID: url.hostname, origin: url.origin, rpName: "Cumulet" };
}

const CHALLENGE_COOKIE = "mc_webauthn";

/** Persist the WebAuthn challenge in a short-lived signed httpOnly cookie. */
export function setChallengeCookie(
  res: NextResponse,
  data: { challenge: string; purpose: "register" | "login"; subject: string },
) {
  res.cookies.set(CHALLENGE_COOKIE, signPayload(data, 300), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 300,
    path: "/",
  });
}

export function readChallengeCookie(
  req: NextRequest,
  purpose: "register" | "login",
): { challenge: string; subject: string } | null {
  const raw = req.cookies.get(CHALLENGE_COOKIE)?.value;
  if (!raw) return null;
  const payload = verifyPayload<{ challenge: string; purpose: string; subject: string }>(raw);
  if (!payload || payload.purpose !== purpose) return null;
  return { challenge: payload.challenge, subject: payload.subject };
}

export function clearChallengeCookie(res: NextResponse) {
  res.cookies.set(CHALLENGE_COOKIE, "", { maxAge: 0, path: "/" });
}
