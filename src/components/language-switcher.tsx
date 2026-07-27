"use client";

import { useLocale } from "next-intl";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { LOCALE_COOKIE } from "@/i18n/config";

const LOCALES = ["zh", "en"] as const;

export function LanguageSwitcher({ persist = true }: { persist?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  const [, startTransition] = useTransition();

  async function switchTo(next: string) {
    if (next === locale) return;
    // Browser cookie assignment is the standard client-side locale switch mechanism.
    // eslint-disable-next-line react-hooks/immutability
    document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=${365 * 24 * 3600};samesite=lax`;
    if (persist) {
      // Best-effort persistence to the user profile; cookie already applies.
      fetch("/api/me/locale", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      }).catch(() => {});
    }
    startTransition(() => router.refresh());
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <Languages className="size-4" />
          {locale === "en" ? t("languageEn") : t("languageZh")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((code) => (
          <DropdownMenuItem key={code} onClick={() => switchTo(code)}>
            {code === "en" ? t("languageEn") : t("languageZh")}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
