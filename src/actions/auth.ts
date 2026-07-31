"use server";

import { headers } from "next/headers";
import { signIn } from "@/auth";
import { AuthError, CredentialsSignin } from "next-auth";
import { ApiError } from "@/lib/api";
import { clientIpFromHeaders, LIMITS, rateLimit } from "@/lib/rate-limit";

export type LoginResult = {
  success: boolean;
  error?: string;
  redirectUrl?: string;
};

/**
 * Password-based admin login Server Action.
 *
 * Calls the server-side signIn from Auth.js directly instead of going through
 * the client-side two-phase flow (providers→CSRF→callback), so login is a
 * single round-trip with no cold-compilation stalls.
 *
 * Rate limiting is handled inside the Credentials provider's authorize function
 * (5 failed attempts = 15‑minute account lockout) plus a per-IP guard here so
 * distributed attempts across many accounts cannot fly under the radar.
 */
export async function passwordLogin(
  email: string,
  password: string,
  callbackUrl = "/admin",
): Promise<LoginResult> {
  const safeCallback = callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
    ? callbackUrl
    : "/admin";
  try {
    rateLimit(
      "adminLogin",
      clientIpFromHeaders(await headers()),
      LIMITS.adminLogin.max,
      LIMITS.adminLogin.windowMs,
    );
    await signIn("admin-password", {
      email,
      password,
      redirect: false,
      redirectTo: safeCallback,
    });
    return { success: true, redirectUrl: safeCallback };
  } catch (error) {
    if (error instanceof ApiError && error.code === "rate_limited") {
      // Uniform error to the client — never reveal the rate-limit state.
      return { success: false, error: "credentials" };
    }
    if (error instanceof CredentialsSignin) {
      return { success: false, error: "credentials" };
    }
    if (error instanceof AuthError) {
      console.error("[auth] AuthError during login:", error.type);
      return { success: false, error: error.type };
    }
    console.error("[auth] Unexpected login error:", error);
    return { success: false, error: "internal" };
  }
}
