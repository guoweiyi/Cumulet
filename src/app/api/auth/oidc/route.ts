import { api, json } from "@/lib/api";
import { getEffectiveOidcSettings } from "@/lib/settings";

export const GET = api(async () => {
  const settings = await getEffectiveOidcSettings();
  const enabled = Boolean(
    settings?.enabled && settings.issuer && settings.clientId && settings.clientSecret,
  );
  return json({ enabled, providerName: settings?.providerName || "SSO" });
});
