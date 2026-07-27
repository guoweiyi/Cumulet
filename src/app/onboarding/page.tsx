"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function OnboardingPage() {
  const t = useTranslations("onboarding");
  const tc = useTranslations("common");
  const router = useRouter();
  const { update } = useSession();
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/me/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ realName: name }),
      });
      if (!res.ok) {
        toast.error(res.status === 400 ? t("invalidName") : tc("requestFailed"));
        return;
      }
      await update(); // refresh JWT claims so middleware stops redirecting here
      router.replace("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <p className="text-sm text-neutral-500">{t("subtitle")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-amber-200 bg-amber-50 text-amber-800">
            <AlertTriangle className="size-4" />
            <AlertDescription className="text-amber-800">{t("warning")}</AlertDescription>
          </Alert>
          <div className="space-y-2">
            <Label htmlFor="realName">{t("realName")}</Label>
            <Input
              id="realName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("realNamePlaceholder")}
              maxLength={32}
            />
          </div>
          <label className="flex items-start gap-2 text-sm text-neutral-600">
            <Checkbox
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              className="mt-0.5"
            />
            {t("confirmCheckbox")}
          </label>
          <Button
            className="w-full"
            disabled={!agreed || name.trim().length < 2 || busy}
            onClick={submit}
          >
            {t("submit")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
