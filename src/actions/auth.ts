"use server";

import { signIn } from "@/auth";
import { AuthError, CredentialsSignin } from "next-auth";

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
 * (5 failed attempts = 15‑minute lockout).
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
    await signIn("admin-password", {
      email,
      password,
      redirect: false,
      redirectTo: safeCallback,
    });
    return { success: true, redirectUrl: safeCallback };
  } catch (error) {
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
