import { getTranslations } from "next-intl/server";
import { requireOnboardedUser } from "@/lib/guards";
import { VpcManager } from "@/components/vpc-manager";

export default async function NetworksPage() {
  await requireOnboardedUser();
  const t = await getTranslations("vpc");
  return <div className="mx-auto max-w-5xl space-y-4"><div><h1 className="text-lg font-semibold">{t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p></div><VpcManager /></div>;
}
