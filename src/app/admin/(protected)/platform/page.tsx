import { requireAdmin } from "@/lib/guards";
import { PlatformManager } from "@/components/admin/platform-manager";

export default async function AdminPlatformPage() {
  const user = await requireAdmin();
  return <PlatformManager canWrite={user.role === "ADMIN" || user.role === "SUPER_ADMIN"} />;
}
