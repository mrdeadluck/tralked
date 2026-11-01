import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getBell } from "@/lib/notifications/inbox";
import { getTrendingSuggestions } from "@/lib/queries/header";
import { timeAgo } from "@/lib/time-ago";
import { Header } from "./Header";

/** Header with the logged-in user's handle and level. Reads cookies, so it must sit in <Suspense>. */
async function HeaderWithUser() {
  const [user, suggestions] = await Promise.all([
    getSessionUser(),
    getTrendingSuggestions(),
  ]);
  const [stats, bell] = user
    ? await Promise.all([
        prisma.userStats.findUnique({
          where: { userId: user.id },
          select: { level: true },
        }),
        getBell(user.id),
      ])
    : [null, null];
  const now = new Date();
  return (
    <Header
      user={
        user
          ? { handle: user.handle, level: stats?.level ?? 1, role: user.role, avatarUrl: user.avatarUrl }
          : undefined
      }
      suggestions={suggestions}
      notifications={
        bell
          ? {
              unread: bell.unread,
              items: bell.items.map(({ id, title, body, href, read, createdAt }) => ({
                id,
                title,
                body,
                href,
                read,
                when: timeAgo(createdAt, now),
              })),
            }
          : undefined
      }
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
