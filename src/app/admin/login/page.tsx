"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint, LogIn, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { LanguageSwitcher } from "@/components/language-switcher";
import { passwordLogin as passwordLoginAction } from "@/actions/auth";
import { useOidcStatus } from "@/hooks/use-oidc-status";

function AdminLoginInner() {
  const t = useTranslations("auth");
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const oidc = useOidcStatus();
  const rawCallback = params.get("callbackUrl") ?? "/admin";
  // Only same-origin relative paths — never redirect off-site.
  const callbackUrl = rawCallback.startsWith("/") && !rawCallback.startsWith("//") ? rawCallback : "/admin";

  async function passwordLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await passwordLoginAction(email, password, callbackUrl);
      if (!result.success) {
        toast.error(t("invalidCredentials"));
        return;
      }
      window.location.assign(result.redirectUrl ?? callbackUrl);
    } finally {
      setBusy(false);
    }
  }

  async function passkeyLogin() {
    if (!email) {
      toast.error(t("email"));
      return;
    }
    setBusy(true);
    try {
      const optRes = await fetch("/api/auth/passkey/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!optRes.ok) throw new Error("options");
      const options = await optRes.json();
      const assertion = await startAuthentication(options);
      const verifyRes = await fetch("/api/auth/passkey/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, assertion }),
      });
      if (!verifyRes.ok) throw new Error("verify");
      const { token } = await verifyRes.json();
      const res = await signIn("passkey", { token, redirect: false });
      if (res?.error) throw new Error("signin");
      window.location.assign(callbackUrl);
    } catch {
      toast.error(t("passkeyFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher persist={false} />
      </div>
      <Card className="w-full max-w-sm shadow-card">
        <CardContent className="flex flex-col gap-5 p-8">
          <div className="flex flex-col items-center gap-2.5">
            <div className="flex size-12 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-card">
              <ShieldCheck className="size-6" strokeWidth={2} />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">{t("adminLoginTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("adminLoginSubtitle")}</p>
          </div>

          <form onSubmit={passwordLogin} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("email")}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username webauthn"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t("password")}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? t("signingIn") : t("signIn")}
            </Button>
          </form>

          <div className="flex items-center gap-3 text-xs text-neutral-400">
            <Separator className="flex-1" /> {t("orDivider")} <Separator className="flex-1" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={busy} onClick={passkeyLogin}>
              <Fingerprint className="size-4" /> Passkey
            </Button>
            <Button
              variant="outline"
              disabled={busy || !oidc?.enabled}
              onClick={() => signIn("oidc", { callbackUrl })}
            >
              <LogIn className="size-4" /> {oidc?.providerName ?? "SSO"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginInner />
    </Suspense>
  );
}
