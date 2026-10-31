/**
 * Gives an existing account a login e-mail and prints a "set your password" link (single use,
 * valid for 1 hour). For accounts without credentials, e.g. an admin created by the old Steam
 * login. The link uses APP_URL: set it to the public address when inviting on a deployed app.
 *
 *   DATABASE_URL=postgresql://... APP_URL=https://... pnpm user:invite <handle> <email>
 *
 * The link is printed only to this terminal (never to scripts/.logs): it opens the account.
 */
import { requireDatabaseUrl } from "./lib/run";

const [handle, email] = process.argv.slice(2);
if (!handle || !email) {
  console.error("Usage: pnpm user:invite <handle> <email>");
  process.exit(2);
}

const db = requireDatabaseUrl();
const { prisma } = await import("@/lib/db");
const { inviteUser } = await import("@/lib/auth/invite");

const MESSAGES = {
  invalid_email: `"${email}" is not a valid e-mail.`,
  not_found: `No user @${handle} in database "${db.name}".`,
  email_taken: `${email} is already the login of another account.`,
} as const;

try {
  const result = await inviteUser(handle, email);
  if (!result.ok) {
    console.error(MESSAGES[result.reason]);
    process.exitCode = 1;
  } else {
    console.log(`@${result.handle} now logs in with ${result.email} (database "${db.name}").`);
    console.log(`Send this link to them; it sets the password and works once, for 1 hour:\n${result.link}`);
  }
} finally {
  await prisma.$disconnect();
}
