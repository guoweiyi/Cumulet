import { requireAdmin } from "@/lib/guards";
import { UsersManager } from "@/components/admin/users-manager";

export default async function AdminUsersPage() {
  const user = await requireAdmin();
  return (
    <UsersManager
      canManage={user.role === "ADMIN" || user.role === "SUPER_ADMIN"}
      canGrantRoles={user.role === "SUPER_ADMIN"}
    />
  );
}
