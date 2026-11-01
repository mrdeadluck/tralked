import { notify } from "@/lib/community/notify";
import type { Db } from "@/lib/community/limits";

/**
 * Follows, friendships and blocks (Plano 4, F9).
 *
 * - Following needs no approval. A friend is always a follower: sending a request follows the other
 *   user, accepting makes both follow each other. Ending a friendship keeps both follows (each one
 *   decides whether to keep following).
 * - Blocking someone ends any follow and friendship (or request) between the two, both ways, and
 *   from then on neither can message, follow or befriend the other; the blocked user cannot reply
 *   to the blocker's comments/posts nor mention them (lib/social/threads.ts, mentions.ts).
 */

/** A pair stored once: the lower id first (database check `*_pair_order_check`). */
export function pairOf(a: string, b: string): { userLowId: string; userHighId: string } {
  return a < b ? { userLowId: a, userHighId: b } : { userLowId: b, userHighId: a };
}

/** True when either user blocked the other. */
export async function isBlockedEither(db: Db, a: string, b: string): Promise<boolean> {
  const count = await db.userBlock.count({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
  });
  return count > 0;
}

/** Everyone the user blocked or was blocked by. */
export async function blockedEitherWay(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
}

export type RelationResult =
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "self" }
  | { status: "blocked" }
  | { status: "rate_limited" };

async function userExists(db: Db, id: string) {
  return (await db.user.count({ where: { id } })) > 0;
}

async function guard(db: Db, me: string, other: string): Promise<RelationResult | null> {
  if (me === other) return { status: "self" };
  if (!(await userExists(db, other))) return { status: "not_found" };
  if (await isBlockedEither(db, me, other)) return { status: "blocked" };
  return null;
}

/** Profile link used in social notifications. */
const profileHref = (handle: string) => `/jogador/${encodeURIComponent(handle)}`;

async function handleOf(db: Db, id: string) {
  return (await db.user.findUnique({ where: { id }, select: { handle: true } }))?.handle ?? "alguém";
}

/** Follows `other` (idempotent) and tells them, once while unread. */
export async function follow(db: Db, me: string, other: string): Promise<RelationResult> {
  const refused = await guard(db, me, other);
  if (refused) return refused;
  const created = await db.follow.createMany({ data: [{ followerId: me, followeeId: other }], skipDuplicates: true });
  if (created.count > 0) {
    const handle = await handleOf(db, me);
    await notify(db, {
      userId: other,
      actorId: me,
      kind: "follow",
      title: `@${handle} começou a seguir você`,
      href: profileHref(handle),
      dedupe: true,
    });
  }
  return { status: "ok" };
}

export async function unfollow(db: Db, me: string, other: string): Promise<RelationResult> {
  await db.follow.deleteMany({ where: { followerId: me, followeeId: other } });
  return { status: "ok" };
}

/** Friend requests a user may send per rolling day (accepted, pending or declined later). */
export const FRIEND_REQUESTS_PER_DAY = 20;

export type FriendRequestResult =
  | RelationResult
  | { status: "requested" }
  | { status: "accepted" }
  | { status: "already_friends" }
  | { status: "already_requested" };

/**
 * Sends a friend request and follows the other user. When the other user already asked, this
 * accepts their request instead. Returns what happened.
 */
export async function requestFriendship(
  db: Db,
  me: string,
  other: string,
  now: Date = new Date(),
): Promise<FriendRequestResult> {
  const refused = await guard(db, me, other);
  if (refused) return refused;
  const pair = pairOf(me, other);
  const existing = await db.friendship.findUnique({ where: { userLowId_userHighId: pair } });
  if (existing?.acceptedAt) return { status: "already_friends" };
  if (existing && existing.requesterId === me) return { status: "already_requested" };
  if (existing) return acceptFriendship(db, me, other, now);

  const sentToday = await db.friendship.count({
    where: { requesterId: me, createdAt: { gte: new Date(now.getTime() - 86_400_000) } },
  });
  if (sentToday >= FRIEND_REQUESTS_PER_DAY) return { status: "rate_limited" };

  await db.friendship.createMany({ data: [{ ...pair, requesterId: me, createdAt: now }], skipDuplicates: true });
  await db.follow.createMany({ data: [{ followerId: me, followeeId: other }], skipDuplicates: true });
  const handle = await handleOf(db, me);
  await notify(db, {
    userId: other,
    actorId: me,
    kind: "friend_request",
    title: `@${handle} quer ser seu amigo`,
    body: "Aceite ou recuse em Amigos, no seu perfil.",
    href: `${profileHref(await handleOf(db, other))}/amigos`,
    dedupe: true,
  });
  return { status: "requested" };
}

/** Accepts the request `other` sent: both now follow each other. */
export async function acceptFriendship(
  db: Db,
  me: string,
  other: string,
  now: Date = new Date(),
): Promise<FriendRequestResult> {
  const refused = await guard(db, me, other);
  if (refused) return refused;
  const accepted = await db.friendship.updateMany({
    where: { ...pairOf(me, other), requesterId: other, acceptedAt: null },
    data: { acceptedAt: now },
  });
  if (accepted.count === 0) return { status: "not_found" };
  await db.follow.createMany({
    data: [
      { followerId: me, followeeId: other },
      { followerId: other, followeeId: me },
    ],
    skipDuplicates: true,
  });
  const handle = await handleOf(db, me);
  await notify(db, {
    userId: other,
    actorId: me,
    kind: "friend_accept",
    title: `@${handle} aceitou seu pedido de amizade`,
    href: profileHref(handle),
  });
  return { status: "accepted" };
}

/**
 * Removes the pair's friendship row: declines a request received, cancels one sent, or ends a
 * friendship. Follows stay as they are. Returns whether a friendship (accepted) ended.
 */
export async function endFriendship(db: Db, me: string, other: string): Promise<{ status: "ok"; wasFriend: boolean }> {
  const pair = pairOf(me, other);
  const row = await db.friendship.findUnique({ where: { userLowId_userHighId: pair }, select: { acceptedAt: true } });
  await db.friendship.deleteMany({ where: pair });
  return { status: "ok", wasFriend: Boolean(row?.acceptedAt) };
}

/** Blocks `other`: ends follows and friendship both ways. Returns whether a friendship ended. */
export async function blockUser(db: Db, me: string, other: string): Promise<RelationResult & { wasFriend?: boolean }> {
  if (me === other) return { status: "self" };
  if (!(await userExists(db, other))) return { status: "not_found" };
  await db.userBlock.createMany({ data: [{ blockerId: me, blockedId: other }], skipDuplicates: true });
  await db.follow.deleteMany({
    where: {
      OR: [
        { followerId: me, followeeId: other },
        { followerId: other, followeeId: me },
      ],
    },
  });
  const { wasFriend } = await endFriendship(db, me, other);
  return { status: "ok", wasFriend };
}

export async function unblockUser(db: Db, me: string, other: string): Promise<RelationResult> {
  await db.userBlock.deleteMany({ where: { blockerId: me, blockedId: other } });
  return { status: "ok" };
}

export type Relationship = {
  following: boolean;
  followedBy: boolean;
  friendship: "none" | "friends" | "sent" | "received";
  /** The viewer blocked them. */
  blocked: boolean;
  /** They blocked the viewer. */
  blockedBy: boolean;
};

/** How the viewer relates to another user (profile buttons). */
export async function getRelationship(db: Db, viewerId: string, otherId: string): Promise<Relationship> {
  const [follows, friendship, blocks] = await Promise.all([
    db.follow.findMany({
      where: {
        OR: [
          { followerId: viewerId, followeeId: otherId },
          { followerId: otherId, followeeId: viewerId },
        ],
      },
      select: { followerId: true },
    }),
    db.friendship.findUnique({ where: { userLowId_userHighId: pairOf(viewerId, otherId) } }),
    db.userBlock.findMany({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: otherId },
          { blockerId: otherId, blockedId: viewerId },
        ],
      },
      select: { blockerId: true },
    }),
  ]);
  return {
    following: follows.some((f) => f.followerId === viewerId),
    followedBy: follows.some((f) => f.followerId === otherId),
    friendship: !friendship
      ? "none"
      : friendship.acceptedAt
        ? "friends"
        : friendship.requesterId === viewerId
          ? "sent"
          : "received",
    blocked: blocks.some((b) => b.blockerId === viewerId),
    blockedBy: blocks.some((b) => b.blockerId === otherId),
  };
}

export type SocialCounts = { followers: number; following: number; friends: number };

export async function socialCounts(db: Db, userId: string): Promise<SocialCounts> {
  const [followers, following, friends] = await Promise.all([
    db.follow.count({ where: { followeeId: userId } }),
    db.follow.count({ where: { followerId: userId } }),
    db.friendship.count({ where: { acceptedAt: { not: null }, OR: [{ userLowId: userId }, { userHighId: userId }] } }),
  ]);
  return { followers, following, friends };
}

export type PersonRow = { id: string; handle: string; displayName: string; avatarUrl: string | null; since: Date };

const personSelect = { id: true, handle: true, displayName: true, avatarUrl: true } as const;

/** People per page in the social lists of a profile. */
export const PEOPLE_PER_PAGE = 40;

export type PeopleList = "seguidores" | "seguindo" | "amigos";

export type PeoplePage = { people: PersonRow[]; total: number; page: number; pageCount: number };

function window(total: number, requested: number) {
  const pageCount = Math.max(1, Math.ceil(total / PEOPLE_PER_PAGE));
  const page = Math.min(Math.max(1, Math.floor(requested) || 1), pageCount);
  return { page, pageCount, skip: (page - 1) * PEOPLE_PER_PAGE, take: PEOPLE_PER_PAGE };
}

/** Followers, followed users or friends of a user, newest first. */
export async function listPeople(db: Db, userId: string, list: PeopleList, requestedPage = 1): Promise<PeoplePage> {
  if (list === "amigos") {
    const where = { acceptedAt: { not: null }, OR: [{ userLowId: userId }, { userHighId: userId }] };
    const total = await db.friendship.count({ where });
    const w = window(total, requestedPage);
    const rows = await db.friendship.findMany({
      where,
      orderBy: { acceptedAt: "desc" },
      skip: w.skip,
      take: w.take,
      select: { acceptedAt: true, userLow: { select: personSelect }, userHigh: { select: personSelect } },
    });
    return {
      people: rows.map((r) => ({ ...(r.userLow.id === userId ? r.userHigh : r.userLow), since: r.acceptedAt! })),
      total,
      page: w.page,
      pageCount: w.pageCount,
    };
  }
  const where = list === "seguidores" ? { followeeId: userId } : { followerId: userId };
  const total = await db.follow.count({ where });
  const w = window(total, requestedPage);
  const rows = await db.follow.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: w.skip,
    take: w.take,
    select: { createdAt: true, follower: { select: personSelect }, followee: { select: personSelect } },
  });
  return {
    people: rows.map((r) => ({ ...(list === "seguidores" ? r.follower : r.followee), since: r.createdAt })),
    total,
    page: w.page,
    pageCount: w.pageCount,
  };
}

/** Friend requests waiting: received (to answer) and sent (to cancel). */
export async function pendingRequests(db: Db, userId: string): Promise<{ received: PersonRow[]; sent: PersonRow[] }> {
  const rows = await db.friendship.findMany({
    where: { acceptedAt: null, OR: [{ userLowId: userId }, { userHighId: userId }] },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      createdAt: true,
      requesterId: true,
      userLow: { select: personSelect },
      userHigh: { select: personSelect },
    },
  });
  const received: PersonRow[] = [];
  const sent: PersonRow[] = [];
  for (const r of rows) {
    const other = r.userLow.id === userId ? r.userHigh : r.userLow;
    (r.requesterId === userId ? sent : received).push({ ...other, since: r.createdAt });
  }
  return { received, sent };
}

/** Users the given user blocked (managed in /conta). */
export async function listBlocked(db: Db, userId: string): Promise<PersonRow[]> {
  const rows = await db.userBlock.findMany({
    where: { blockerId: userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, blocked: { select: personSelect } },
  });
  return rows.map((r) => ({ ...r.blocked, since: r.createdAt }));
}
