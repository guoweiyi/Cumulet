/** OIDC email is an authorization key, so an unverified claim is unusable. */
export function trustedOidcEmail(profile: Record<string, unknown> | undefined): string | null {
  const email = typeof profile?.email === "string" ? profile.email.trim().toLowerCase() : "";
  return email && profile?.email_verified === true ? email : null;
}
