/**
 * Prints "Tralked" and "Platinas" (lib/character/counts) of some players, read-only.
 *
 *   pnpm exec tsx scripts/counters-measure.ts diguzz MrDead_
 *
 * Refuses to run unless the session reports default_transaction_read_only = on (the caller
 * appends `options=-c default_transaction_read_only=on` to DATABASE_URL). Production: use the
 * direct URL (DATABASE_URL_UNPOOLED).
 */
import { platinumTallyOf } from "@/lib/character/counts";
import { prisma } from "@/lib/db";

async function main() {
  const [{ default_transaction_read_only: ro }] = await prisma.$queryRaw<{ default_transaction_read_only: string }[]>`SHOW default_transaction_read_only`;
  if (ro !== "on") {
    console.error(`Session is not read-only (default_transaction_read_only = ${ro}).`);
    process.exit(2);
  }
  console.log(`default_transaction_read_only = ${ro}`);
  for (const handle of process.argv.slice(2)) {
    const user = await prisma.user.findFirst({ where: { handle: { equals: handle, mode: "insensitive" } }, select: { id: true, handle: true } });
    if (!user) {
      console.log(`${handle}: not found`);
      continue;
    }
    const t = await platinumTallyOf(user.id);
    console.log(`${user.handle}: Tralked ${t.tralked} ${JSON.stringify(t.tralkedByPlatform)} | Platinas ${t.platinums} ${JSON.stringify(t.byPlatform)}`);
  }
  await prisma.$disconnect();
}
main();
