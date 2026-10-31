import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getTrendingSuggestions } from "@/lib/queries/header";
import { Header } from "./Header";

/** Header with the logged-in user's handle and level. Reads cookies, so it must sit in <Suspense>. */
async function HeaderWithUser() {
  const [user, suggestions] = await Promise.all([
    getSessionUser(),
    getTrendingSuggestions(),
  ]);
  const stats = user
    ? await prisma.userStats.findUnique({
        where: { userId: user.id },
        select: { level: true },
      })
    : null;
  return (
    <Header
      user={
        user
          ? { handle: user.handle, level: stats?.level ?? 1, role: user.role }
          : undefined
      }
      suggestions={suggestions}
    />
  );
}

/** Anonymous header shown while the session is resolved (and in prerendered shells). */
function HeaderFallback() {
  return (
    // usePathname (aria-current) pode suspender em rotas dinâmicas com Cache Components.
    <Suspense fallback={<div className="h-[71px] border-b border-line" />}>
      <Header />
    </Suspense>
  );
}

export function SessionHeader() {
  return (
    <Suspense fallback={<HeaderFallback />}>
      <HeaderWithUser />
    </Suspense>
  );
}
