import { requireAdmin } from "@/lib/guards";
import { AccountSecurity } from "@/components/admin/account-security";

export default async function AdminProfilePage() {
  await requireAdmin();
  return <AccountSecurity />;
}
