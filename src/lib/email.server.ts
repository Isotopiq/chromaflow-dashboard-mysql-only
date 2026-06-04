// Transactional email via SMTP (nodemailer).
import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT ?? 587);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASSWORD;
const from = process.env.SMTP_FROM ?? user ?? "no-reply@example.com";

declare global {
  // eslint-disable-next-line no-var
  var __chromaSmtpTransport: nodemailer.Transporter | undefined;
}

function transport() {
  if (globalThis.__chromaSmtpTransport) return globalThis.__chromaSmtpTransport;
  if (!host) {
    console.warn("[email] SMTP_HOST is not set; emails will be logged only");
    return null;
  }
  globalThis.__chromaSmtpTransport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });
  return globalThis.__chromaSmtpTransport;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<void> {
  const t = transport();
  if (!t) {
    console.info(`[email:log-only] to=${opts.to} subject=${opts.subject}`);
    return;
  }
  await t.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text ?? opts.html.replace(/<[^>]+>/g, ""),
  });
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:5273").replace(/\/+$/, "");
}
