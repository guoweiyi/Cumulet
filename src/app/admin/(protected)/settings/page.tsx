import { redirect } from "next/navigation";
import { currentUser } from "@/lib/guards";
import { SettingsManager } from "@/components/admin/settings-manager";

export default async function AdminSettingsPage() {
  const user = await currentUser();
  // SUPER_ADMIN only — enforced again in the API.
  if (!user || user.role !== "SUPER_ADMIN") redirect("/admin");
  return <SettingsManager />;
}
