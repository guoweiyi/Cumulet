import { requireAdmin } from "@/lib/guards";
import { AuditViewer } from "@/components/admin/audit-viewer";

export default async function AdminAuditPage() {
  await requireAdmin();
  return <AuditViewer />;
}
