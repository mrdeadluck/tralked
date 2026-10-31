import { env } from "@/lib/env";
import type { MailKind, MailMessage } from "./mailer";

/**
 * Tralked's e-mails, in pt-BR: a simple single-column layout with inline styles (e-mail clients
 * ignore stylesheets), the wordmark as text (no external images), a button plus the same link
 * written out, and a plain-text part with the same content. Colors are the site's tokens
 * (app/src/app/globals.css), copied as hex because e-mail has no CSS variables.
 */

const COLORS = {
  bg: "#0b0c0f", // --bg
  surface: "#121317", // --surface
  border: "#2c2e36", // --border-2
  text: "#ecece6", // --text
  text2: "#c9cbd1", // --text-2
  muted: "#9ea1a9", // --muted
  acc: "#c6f432", // --acc
};

const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace";
export const SLOGAN = "Tralked — Seu ecossistema gamer";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type EmailContent = {
  subject: string;
  /** Short summary shown by inboxes next to the subject. */
  preheader: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  /** Small print under the button (why you got it, what to do if it was not you). */
  footnote?: string;
};

export function renderEmail(content: EmailContent): { html: string; text: string } {
  const site = new URL("/", env.APP_URL).toString();
  const p = (text: string) =>
    `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.55;color:${COLORS.text2};">${escapeHtml(text)}</p>`;
  const action = content.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr><td style="background:${COLORS.acc};border-radius:2px;">` +
      `<a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:14px 22px;font-family:${MONO};font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${COLORS.bg};text-decoration:none;">${escapeHtml(content.action.label)}</a>` +
      `</td></tr></table>` +
      `<p style="margin:0 0 16px;font-family:${SANS};font-size:13px;line-height:1.5;color:${COLORS.muted};">Se o botão não funcionar, copie este endereço no navegador:<br>` +
      `<a href="${escapeHtml(content.action.url)}" style="color:${COLORS.acc};word-break:break-all;">${escapeHtml(content.action.url)}</a></p>`
    : "";
  const footnote = content.footnote
    ? `<p style="margin:8px 0 0;font-family:${SANS};font-size:13px;line-height:1.5;color:${COLORS.muted};">${escapeHtml(content.footnote)}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:4px;">
<tr><td style="padding:28px 32px 0;font-family:${SANS};font-size:22px;font-weight:900;letter-spacing:0.14em;color:${COLORS.text};">TRAL<span style="color:${COLORS.acc};">K</span>ED</td></tr>
<tr><td style="padding:24px 32px 28px;">
<h1 style="margin:0 0 18px;font-family:${SANS};font-size:24px;line-height:1.2;font-weight:900;color:${COLORS.text};">${escapeHtml(content.heading)}</h1>
${content.paragraphs.map(p).join("\n")}
${action}
${footnote}
</td></tr>
</table>
<p style="margin:20px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${COLORS.muted};">${escapeHtml(SLOGAN)} · <a href="${escapeHtml(site)}" style="color:${COLORS.muted};">${escapeHtml(new URL(site).host)}</a><br>E-mail automático: respostas a este endereço não são lidas.</p>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    "TRALKED",
    "",
    content.heading,
    "",
    ...content.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...(content.action ? [`${content.action.label}: ${content.action.url}`, ""] : []),
    ...(content.footnote ? [content.footnote, ""] : []),
    "--",
    `${SLOGAN} · ${site}`,
    "E-mail automático: respostas a este endereço não são lidas.",
  ].join("\n");

  return { html, text };
}

function message(kind: MailKind, to: string, content: EmailContent, idempotencyKey?: string): MailMessage {
  return { kind, to, subject: content.subject, link: content.action?.url, idempotencyKey, ...renderEmail(content) };
}

export function passwordResetEmail(to: string, link: string): MailMessage {
  return message("password-reset", to, {
    subject: "Crie uma nova senha do Tralked",
    preheader: "O link vale 1 hora e funciona uma vez.",
    heading: "Nova senha",
    paragraphs: [
      "Recebemos um pedido para criar uma nova senha para a sua conta do Tralked.",
      "O link vale 1 hora e funciona uma vez só. Se você pediu mais de um, use o mais recente.",
    ],
    action: { label: "Criar nova senha", url: link },
    footnote: "Não foi você? Ignore este e-mail: a sua senha continua a mesma. O Tralked nunca pede a senha por e-mail.",
  });
}

export function emailConfirmationEmail(to: string, displayName: string, link: string): MailMessage {
  return message("email-confirmation", to, {
    subject: "Confirme o seu e-mail no Tralked",
    preheader: "Um clique para confirmar que este e-mail é seu.",
    heading: "Confirme o seu e-mail",
    paragraphs: [
      `Oi, ${displayName}! Confirme que ${to} é o seu e-mail no Tralked. Assim a sua conta ganha o selo "e-mail confirmado" e você consegue recuperar a senha por ele.`,
      "O link vale 7 dias.",
    ],
    action: { label: "Confirmar e-mail", url: link },
    footnote: "Não criou uma conta no Tralked? Ignore este e-mail: sem a confirmação, nada muda.",
  });
}

/**
 * Welcome after signing up. With `confirmLink` (e-mail + password sign-up) it also carries the
 * e-mail confirmation, so a new account gets a single e-mail; a Google sign-up (e-mail already
 * verified by Google) gets it without.
 */
export function welcomeEmail(to: string, displayName: string, confirmLink?: string): MailMessage {
  const connections = new URL("/conta/conexoes", env.APP_URL).toString();
  return message(
    "welcome",
    to,
    {
      subject: "Bem-vindo ao Tralked",
      preheader: "Conecte as suas plataformas e veja o seu personagem subir de nível.",
      heading: `Bem-vindo, ${displayName}!`,
      paragraphs: [
        "A sua conta do Tralked está pronta. Em Conexões, informe o seu perfil da Steam, PlayStation, Xbox ou RetroAchievements: o Tralked importa jogos, horas e conquistas e transforma tudo em XP no mesmo personagem.",
        `Conexões: ${connections}`,
        ...(confirmLink
          ? ["Falta só um passo: confirme que este e-mail é seu (o link vale 7 dias). Dá para usar o Tralked antes disso."]
          : []),
      ],
      action: confirmLink
        ? { label: "Confirmar e-mail", url: confirmLink }
        : { label: "Conectar plataformas", url: connections },
      footnote: "O Tralked nunca pede a senha da Steam, da PSN, do Xbox ou do Google. A única senha é a do próprio Tralked.",
    },
  );
}

export function newsletterConfirmationEmail(to: string, link: string): MailMessage {
  return message("newsletter-confirmation", to, {
    subject: "Confirme a sua inscrição na newsletter do Tralked",
    preheader: "As principais notícias e guias da semana, só depois da sua confirmação.",
    heading: "Confirme a inscrição",
    paragraphs: [
      `Alguém (esperamos que você) pediu para receber a newsletter semanal do Tralked em ${to}.`,
      "A inscrição só vale depois da confirmação. O link vale 7 dias.",
    ],
    action: { label: "Confirmar inscrição", url: link },
    footnote: "Não pediu? Ignore este e-mail: sem a confirmação, você não recebe nada.",
  });
}

