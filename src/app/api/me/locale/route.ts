import { NextRequest } from "next/server";
import { api, badRequest, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";

/** Persist the caller's preferred locale (also sets the locale cookie). */
export const PATCH = api(async (req: NextRequest) => {
  const user = await requireUser();
  const body = await req.json().catch(() => ({}));
  if (!isLocale(body.locale)) throw badRequest("invalid_locale");
  await prisma.user.update({ where: { id: user.id }, data: { preferredLocale: body.locale } });
  const res = json({ ok: true });
  res.cookies.set(LOCALE_COOKIE, body.locale, {
    path: "/",
    sameSite: "lax",
    maxAge: 365 * 24 * 3600,
  });
  return res;
});
