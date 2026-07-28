import { fetch as ufetch } from "undici";
import { api, json, ApiError } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/guards";
import { getEffectiveOidcSettings } from "@/lib/settings";

export const POST = api(async () => {
  await requireSuperAdmin();
  const settings = await getEffectiveOidcSettings();
  if (!settings?.enabled || !settings.issuer || !settings.clientId || !settings.clientSecret) {
    throw new ApiError(409, "oidc_not_configured");
  }
  const url = new URL(
    ".well-known/openid-configuration",
    `${settings.issuer.replace(/\/$/, "")}/`,
  );
  const response = await ufetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new ApiError(502, "oidc_discovery_failed");
  const discovery = await response.json() as Record<string, unknown>;
  if (
    typeof discovery.authorization_endpoint !== "string" ||
    typeof discovery.token_endpoint !== "string" ||
    typeof discovery.jwks_uri !== "string"
  ) {
    throw new ApiError(502, "oidc_discovery_invalid");
  }
  return json({ ok: true, issuer: discovery.issuer ?? settings.issuer });
});
