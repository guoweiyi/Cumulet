"use client";

import type { TicketDetailData } from "@/lib/ticket-data";
import { TicketDetail } from "./ticket-detail";
import { AdminTicketActions } from "./admin-ticket-actions";
import { PipelineTracker } from "./pipeline-tracker";

export function AdminTicketView({
  initial,
  canWrite,
}: {
  initial: TicketDetailData;
  canWrite: boolean;
}) {
  return (
    <TicketDetail
      initial={initial}
      isAdmin
      canWrite={canWrite}
      adminActions={
        canWrite ? (ticket, reload) => <AdminTicketActions ticket={ticket} reload={reload} /> : undefined
      }
      pipelinePanel={initial.isSystemAlert ? undefined : (ticket, reload) => (
          <PipelineTracker ticket={ticket} canWrite={canWrite} reload={reload} />
        )}
    />
  );
}
