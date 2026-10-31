/**
 * The node test project writes to Postgres. Refuse to run unless DATABASE_URL names a dedicated
 * test database: `gamelog` and `gamelog_dev` belong to the development servers, and without
 * DATABASE_URL the app would fall back to `gamelog` (src/lib/env.ts).
 */
const FORBIDDEN = new Set(["gamelog", "gamelog_dev"]);

function databaseName(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) || null;
  } catch {
    return null;
  }
}

const url = process.env.DATABASE_URL?.trim();
const dbName = url ? databaseName(url) : null;

if (!url || !dbName || FORBIDDEN.has(dbName)) {
  throw new Error(
    [
      !url
        ? "DATABASE_URL is not set."
        : !dbName
          ? `DATABASE_URL has no database name: ${url}`
          : `DATABASE_URL points at "${dbName}", which belongs to a development server.`,
      "Tests write to the database: use a dedicated one, e.g.",
      "  docker exec gamelog-db createdb -U gamelog gamelog_test",
      "  DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_test pnpm exec prisma migrate deploy",
      "  DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_test pnpm db:seed",
      "  DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_test pnpm test",
    ].join("\n"),
  );
}

export {};
