"use client";

import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Cloud, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/language-switcher";

function LoginInner() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const callbackUrl = params.get("callbackUrl") ?? "/";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher persist={false} />
      </div>
      <Card className="w-full max-w-sm shadow-card">
        <CardContent className="flex flex-col items-center gap-5 p-8">
          <div className="flex flex-col items-center gap-2.5">
            <div className="flex size-12 items-center justify-center rounded-xl bg-brand text-brand-foreground shadow-card">
              <Cloud className="size-6" strokeWidth={2} />
            </div>
            <span className="text-sm font-semibold tracking-tight">栖云 · Cumulet</span>
          </div>
          <div className="text-center">
            <h1 className="text-lg font-semibold tracking-tight">{t("loginTitle")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("loginSubtitle")}</p>
          </div>
          <Button
            className="w-full"
            size="lg"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              // callbackUrl is restricted to same-origin paths by Auth.js
              signIn("oidc", { callbackUrl });
            }}
          >
            <LogIn className="size-4" />
            {busy ? t("signingIn") : t("loginWithSso")}
          </Button>
        </CardContent>
      </Card>
      <p className="mt-6 text-xs text-muted-foreground/70">{tc("appName")}</p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
