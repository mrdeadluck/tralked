/**
 * Creates a bot API key (the same thing /admin/robos does) and prints the secret once.
 *
 *   DATABASE_URL=postgresql://... pnpm api:key "<name>" <scope> [<scope>...]
 *
 * Scopes: articles:write, guides:write, publish, media:write. Exits 2 on an unknown scope.
 * The secret is printed only to this terminal (never to scripts/.logs): it cannot be recovered,
 * the database keeps only its hash.
 */
import { requireDatabaseUrl } from "./lib/run";

const [name, ...scopes] = process.argv.slice(2);
const db = requireDatabaseUrl();
const { prisma } = await import("@/lib/db");
const { API_SCOPES, createApiKey, createApiKeyInput } = await import("@/lib/api/keys");

const usage = `Usage: pnpm api:key "<name>" <scope> [<scope>...]\nScopes: ${API_SCOPES.join(", ")}`;

try {
  if (!name || scopes.length === 0) {
    console.error(usage);
    process.exitCode = 2;
  } else {
    const unknown = scopes.filter((scope) => !(API_SCOPES as readonly string[]).includes(scope));
    const input = createApiKeyInput.safeParse({ name, scopes });
    if (unknown.length > 0) {
      console.error(`Unknown scope: ${unknown.join(", ")}\n${usage}`);
      process.exitCode = 2;
    } else if (!input.success) {
      console.error(`${input.error.issues.map((issue) => issue.message).join("; ")}\n${usage}`);
      process.exitCode = 2;
    } else {
      const key = await createApiKey({ name: input.data.name, scopes: input.data.scopes });
      console.log(`Key "${input.data.name}" created in database "${db.name}" with scopes: ${input.data.scopes.join(", ")}.`);
      console.log(`Secret (shown only now, it cannot be recovered):\n${key.secret}`);
    }
  }
} finally {
  await prisma.$disconnect();
}
