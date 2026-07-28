import { prisma } from "./prisma";
import { sendMail } from "./mailer";

/**
 * Localized transactional emails. All interpolated values are HTML-escaped;
 * templates are plain server-side strings (no user-controlled markup).
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type L = "zh" | "en";

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function layout(title: string, bodyHtml: string): string {
  return `<div style="font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h2 style="font-size:18px">${title}</h2>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
  <p style="font-size:12px;color:#999">栖云 Cumulet · ${escapeHtml(baseUrl())}</p>
</div>`;
}

async function localeOf(userId: string): Promise<L> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { preferredLocale: true } });
  return u?.preferredLocale === "en" ? "en" : "zh";
}

export async function emailTicketStatus(
  userId: string,
  email: string,
  ticketId: string,
  event: "approved" | "rejected" | "closed",
  reason?: string,
): Promise<void> {
  const l = await localeOf(userId);
  const url = `${baseUrl()}/tickets/${ticketId}`;
  const subjects: Record<typeof event, Record<L, string>> = {
    approved: { zh: "您的资源申请已批准", en: "Your resource request was approved" },
    rejected: { zh: "您的资源申请未通过", en: "Your resource request was rejected" },
    closed: { zh: "您的工单已关闭", en: "Your ticket was closed" },
  };
  const bodies: Record<typeof event, Record<L, string>> = {
    approved: {
      zh: "管理员已批准您的资源申请，系统正在自动开通资源，完成后将另行通知。",
      en: "An administrator approved your request. Provisioning has started — you will be notified when it completes.",
    },
    rejected: {
      zh: "很抱歉，您的资源申请未获批准。",
      en: "Unfortunately your resource request was not approved.",
    },
    closed: { zh: "您的工单已被关闭。", en: "Your ticket has been closed." },
  };
  const linkText = l === "zh" ? "查看工单" : "View ticket";
  let body = `<p>${bodies[event][l]}</p>`;
  if (reason) {
    body += `<p style="background:#f6f6f6;padding:12px;border-radius:8px">${escapeHtml(reason)}</p>`;
  }
  body += `<p><a href="${url}">${linkText}</a></p>`;
  await sendMail(email, subjects[event][l], layout(subjects[event][l], body));
}

export async function emailAdminReply(userId: string, email: string, ticketId: string): Promise<void> {
  const l = await localeOf(userId);
  const url = `${baseUrl()}/tickets/${ticketId}`;
  const subject = l === "zh" ? "工单有新回复" : "New reply on your ticket";
  const body =
    l === "zh"
      ? `<p>管理员在您的工单中添加了新回复。</p><p><a href="${url}">查看工单</a></p>`
      : `<p>An administrator replied to your ticket.</p><p><a href="${url}">View ticket</a></p>`;
  await sendMail(email, subject, layout(subject, body));
}

export async function emailProvisioned(
  userId: string,
  email: string,
  opts: { ticketId: string; credentialUrl: string; jsPortalUrl: string; assetName: string },
): Promise<void> {
  const l = await localeOf(userId);
  const subject = l === "zh" ? "您的云资源已开通" : "Your cloud resource is ready";
  const body =
    l === "zh"
      ? `<p>您的云资源已开通完成。</p>
<p><strong>初始凭据（仅可查看一次）：</strong><br/><a href="${opts.credentialUrl}">${opts.credentialUrl}</a></p>
<p><strong>SSH 连接方式：</strong>请通过堡垒机门户 <a href="${escapeHtml(opts.jsPortalUrl)}">${escapeHtml(opts.jsPortalUrl)}</a> 登录，
在资产列表中找到「${escapeHtml(opts.assetName)}」，点击即可打开网页终端，或使用本地 SSH 客户端经堡垒机连接。</p>
<p><a href="${baseUrl()}/tickets/${opts.ticketId}">查看工单</a> · <a href="${baseUrl()}/servers">管理服务器</a></p>`
      : `<p>Your cloud resource has been provisioned.</p>
<p><strong>Initial credentials (viewable once):</strong><br/><a href="${opts.credentialUrl}">${opts.credentialUrl}</a></p>
<p><strong>How to connect via SSH:</strong> sign in to the bastion portal at <a href="${escapeHtml(opts.jsPortalUrl)}">${escapeHtml(opts.jsPortalUrl)}</a>,
find the asset “${escapeHtml(opts.assetName)}” in the asset list and click it for a web terminal, or connect with a local SSH client through the bastion.</p>
<p><a href="${baseUrl()}/tickets/${opts.ticketId}">View ticket</a> · <a href="${baseUrl()}/servers">Manage servers</a></p>`;
  await sendMail(email, subject, layout(subject, body));
}

export async function emailPasswordReset(userId: string, email: string, bindingLabel: string): Promise<void> {
  const l = await localeOf(userId);
  const subject = l === "zh" ? "服务器密码已重置" : "Server password was reset";
  const body =
    l === "zh"
      ? `<p>您的服务器 ${escapeHtml(bindingLabel)} 的系统密码已通过 Guest Agent 立即重置，无需重启。新密码已在控制台展示（仅一次）。</p>`
      : `<p>The OS password of your server ${escapeHtml(bindingLabel)} was reset immediately through the guest agent. The new password was shown once in the console.</p>`;
  await sendMail(email, subject, layout(subject, body));
}

export async function emailLeaseWarning(
  userId: string,
  email: string,
  resourceName: string,
  expiresAt: Date,
): Promise<boolean> {
  const l = await localeOf(userId);
  const date = new Intl.DateTimeFormat(l === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(expiresAt);
  const subject = l === "zh" ? "云资源将在 3 天内到期" : "Cloud resource expires within 3 days";
  const body = l === "zh"
    ? `<p>资源 <strong>${escapeHtml(resourceName)}</strong> 将于 ${escapeHtml(date)} 到期。请及时联系管理员续期；到期后系统会自动关机。</p><p><a href="${baseUrl()}/servers">查看资源</a></p>`
    : `<p>Resource <strong>${escapeHtml(resourceName)}</strong> expires on ${escapeHtml(date)}. Contact an administrator to renew it; the VM will be shut down automatically at expiration.</p><p><a href="${baseUrl()}/servers">View resources</a></p>`;
  return sendMail(email, subject, layout(subject, body));
}

/** Provisioning step failure — notify all ADMIN/SUPER_ADMIN users. */
export async function emailStepFailedToAdmins(ticketId: string, step: string, error: string): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } },
    select: { email: true },
  });
  const url = `${baseUrl()}/admin/tickets/${ticketId}`;
  const subject = `[Cumulet] Provisioning step failed: ${step}`;
  const body = `<p>Pipeline step <strong>${escapeHtml(step)}</strong> failed for ticket ${escapeHtml(ticketId)}.</p>
<p style="background:#fef2f2;padding:12px;border-radius:8px;color:#b91c1c">${escapeHtml(error)}</p>
<p><a href="${url}">Open ticket</a></p>`;
  for (const a of admins) {
    await sendMail(a.email, subject, layout(subject, body));
  }
}

export async function emailAiAlertToAdmins(
  ticketId: string,
  vmid: number,
  score: number,
  summary: string,
): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } },
    select: { email: true },
  });
  const subject = `[Cumulet] AI inspection alert: VM ${vmid}`;
  const body = `<p>AI inspection reported a critical issue for VM <strong>${vmid}</strong> (health score: ${score}/100).</p>
<p style="background:#fef2f2;padding:12px;border-radius:8px;color:#b91c1c">${escapeHtml(summary)}</p>
<p><a href="${baseUrl()}/admin/tickets/${ticketId}">Open alert ticket</a></p>`;
  for (const admin of admins) {
    await sendMail(admin.email, subject, layout(subject, body));
  }
}
