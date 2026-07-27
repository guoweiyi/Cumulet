import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/guards";
import { getTicketDetail } from "@/lib/ticket-data";
import { AdminTicketView } from "@/components/tickets/admin-ticket-view";

export default async function AdminTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAdmin();
  const { id } = await params;
  const detail = await getTicketDetail(id, true);
  if (!detail) notFound();

  const canWrite = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  return <AdminTicketView initial={detail} canWrite={canWrite} />;
}
