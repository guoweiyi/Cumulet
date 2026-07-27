"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Copy, KeyRound, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/language-switcher";

type Creds = { user: string; password: string; ip: string; jsPortalUrl: string };

export function CredentialViewer({ token }: { token: string }) {
  const t = useTranslations("credentials");
  const tc = useTranslations("common");
  const [state, setState] = useState<"loading" | "ok" | "gone">("loading");
  const [creds, setCreds] = useState<Creds | null>(null);

  useEffect(() => {
    // POST consumes the token exactly once.
    fetch(`/api/credentials/${encodeURIComponent(token)}`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          setState("gone");
          return;
        }
        const data = await res.json();
        setCreds(data.credentials);
        setState("ok");
      })
      .catch(() => setState("gone"));
  }, [token]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-100 p-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher persist={false} />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-blue-600" />
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === "loading" && (
            <div className="flex justify-center py-8">
              <Loader2 className="size-6 animate-spin text-neutral-400" />
            </div>
          )}
          {state === "gone" && (
            <Alert className="border-red-200 bg-red-50 text-red-700">
              <AlertTriangle className="size-4" />
              <AlertDescription className="text-red-700">{t("expiredOrUsed")}</AlertDescription>
            </Alert>
          )}
          {state === "ok" && creds && (
            <>
              <Alert className="border-amber-200 bg-amber-50 text-amber-800">
                <AlertTriangle className="size-4" />
                <AlertDescription className="text-amber-800">{t("warning")}</AlertDescription>
              </Alert>
              <CredRow label={t("user")} value={creds.user} />
              <CredRow label={t("password")} value={creds.password} mono />
              <CredRow label={t("ip")} value={creds.ip} />
              {creds.jsPortalUrl && <CredRow label={t("jumpserver")} value={creds.jsPortalUrl} />}
              <Button className="w-full" onClick={() => window.close()}>
                {t("confirmRead")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
      <p className="mt-4 text-xs text-neutral-400">{tc("appName")}</p>
    </div>
  );
}

function CredRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const tc = useTranslations("common");
  return (
    <div>
      <p className="mb-1 text-xs text-neutral-500">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border bg-neutral-50 px-3 py-2">
        <code className={`flex-1 text-sm ${mono ? "font-semibold tracking-wide" : ""}`}>{value}</code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(value);
            toast.success(tc("copied"));
          }}
          className="text-neutral-400 hover:text-blue-600"
        >
          <Copy className="size-4" />
        </button>
      </div>
    </div>
  );
}
