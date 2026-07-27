import nodemailer from "nodemailer";
import { getSetting } from "./settings";
import { LIMITS, rateLimit } from "./rate-limit";

/**
 * SMTP config is read from the database at send time — changes apply without
 * a restart. Unconfigured SMTP logs a warning and skips; it never throws
 * into business flows.
 */
export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  const smtp = await getSetting("smtp");
  if (!smtp?.host || !smtp.from) {
    console.warn(`[mailer] SMTP not configured — skipping mail to ${to} (“${subject}”)`);
    return false;
  }
  try {
    rateLimit("email", "global", LIMITS.email.max, LIMITS.email.windowMs);
  } catch {
    console.warn("[mailer] outbound email rate limit hit — skipping");
    return false;
  }
  try {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    });
    await transport.sendMail({ from: smtp.from, to, subject, html });
    return true;
  } catch (err) {
    console.error(`[mailer] failed to send to ${to}:`, err);
    return false;
  }
}

/** Send a test email (admin settings "Send test" button). */
export async function sendTestMail(to: string): Promise<void> {
  const smtp = await getSetting("smtp");
  if (!smtp?.host || !smtp.from) throw new Error("SMTP not configured");
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  await transport.sendMail({
    from: smtp.from,
    to,
    subject: "栖云 Cumulet SMTP test / 邮件配置测试",
    html: "<p>SMTP configuration works. / SMTP 配置正常。</p>",
  });
}
