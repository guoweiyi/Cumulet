import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";
import { getTicketDetail } from "@/lib/ticket-data";
import { TicketDetail } from "@/components/tickets/ticket-detail";

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  // Strict ownership: a USER can only ever open their own ticket (404 otherwise).
  const ticket = await prisma.ticket.findFirst({
    where: { id, userId: user.id, sourceInspection: null },
  });
  if (!ticket) notFound();

  const detail = await getTicketDetail(id, false);
  if (!detail) notFound();

  return <TicketDetail initial={detail} isAdmin={false} canWrite />;
}
