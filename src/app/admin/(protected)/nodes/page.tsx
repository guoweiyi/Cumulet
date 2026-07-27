import { requireAdmin } from "@/lib/guards";
import { NodesManager } from "@/components/admin/nodes-manager";

export default async function AdminNodesPage() {
  const user = await requireAdmin();
  return <NodesManager canWrite={user.role === "ADMIN" || user.role === "SUPER_ADMIN"} />;
}
