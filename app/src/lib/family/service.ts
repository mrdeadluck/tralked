import { randomBytes } from "node:crypto";
import type { Family, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import type { SkillId } from "@/lib/engine/types";

export const MAX_FAMILY_MEMBERS = 6;
export const INVITE_TTL_DAYS = 7;
export const FAMILY_NAME_MIN = 3;
export const FAMILY_NAME_MAX = 40;

const DAY_MS = 24 * 60 * 60 * 1000;

export type FamilyErrorCode = "invalid_name" | "already_in_family" | "not_member";

export class FamilyError extends Error {
  constructor(
    readonly code: FamilyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FamilyError";
  }
}

export type AcceptInviteFailure = "expired" | "used" | "already_in_family" | "not_found" | "full";
export type AcceptInviteResult = { ok: true } | { ok: false; reason: AcceptInviteFailure };

export const INVITE_ERROR_MESSAGES: Record<AcceptInviteFailure, string> = {
  expired: "Este convite expirou. Peça um novo link.",
  used: "Este convite já foi usado.",
  already_in_family:
    "Você já faz parte de uma família. Saia dela antes de entrar em outra.",
  not_found: "Convite não encontrado. Confira o link com quem convidou você.",
  full: `Esta família já tem ${MAX_FAMILY_MEMBERS} membros e não aceita mais ninguém.`,
};

type Tx = Prisma.TransactionClient;

/** Row-locks the family so concurrent joins/leaves on the same family run one at a time. */
async function lockFamily(tx: Tx, familyId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Family" WHERE id = ${familyId} FOR UPDATE`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

// ---------------------------------------------------------------- create / invite

export async function createFamily(ownerId: string, name: string): Promise<Family> {
  const trimmed = name.trim();
  if (trimmed.length < FAMILY_NAME_MIN || trimmed.length > FAMILY_NAME_MAX) {
    throw new FamilyError(
      "invalid_name",
      `O nome da família deve ter entre ${FAMILY_NAME_MIN} e ${FAMILY_NAME_MAX} caracteres.`,
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.familyMember.findUnique({ where: { userId: ownerId } });
      if (existing) {
        throw new FamilyError("already_in_family", INVITE_ERROR_MESSAGES.already_in_family);
      }
      const family = await tx.family.create({ data: { name: trimmed, ownerId } });
      await tx.familyMember.create({
        data: { familyId: family.id, userId: ownerId, role: "owner" },
      });
      return family;
    });
  } catch (error) {
    // userId is unique on FamilyMember: a concurrent create by the same user loses the race.
    if (isUniqueViolation(error)) {
      throw new FamilyError("already_in_family", INVITE_ERROR_MESSAGES.already_in_family);
    }
    throw error;
  }
}

export async function createInvite(
  familyId: string,
  byUserId: string,
): Promise<{ token: string; url: string; expiresAt: Date }> {
  const membership = await prisma.familyMember.findUnique({
    where: { familyId_userId: { familyId, userId: byUserId } },
  });
  if (!membership) {
    throw new FamilyError("not_member", "Só membros da família podem criar convites.");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * DAY_MS);
  await prisma.familyInvite.create({ data: { familyId, token, expiresAt } });
  return { token, url: `${env.APP_URL}/familia/convite/${token}`, expiresAt };
}

// ---------------------------------------------------------------- accept / leave

export async function acceptInvite(token: string, userId: string): Promise<AcceptInviteResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const found = await tx.familyInvite.findUnique({ where: { token } });
      if (!found) return { ok: false, reason: "not_found" };

      await lockFamily(tx, found.familyId);

      // Re-read under the lock: another accept may have consumed the token meanwhile.
      const invite = await tx.familyInvite.findUnique({ where: { token } });
      if (!invite) return { ok: false, reason: "not_found" };
      if (invite.usedAt) return { ok: false, reason: "used" };
      if (invite.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

      const existing = await tx.familyMember.findUnique({ where: { userId } });
      if (existing) return { ok: false, reason: "already_in_family" };

      const count = await tx.familyMember.count({ where: { familyId: invite.familyId } });
      if (count >= MAX_FAMILY_MEMBERS) return { ok: false, reason: "full" };

      await tx.familyInvite.update({ where: { token }, data: { usedAt: new Date() } });
      await tx.familyMember.create({
        data: { familyId: invite.familyId, userId, role: "member" },
      });
      return { ok: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "already_in_family" };
    throw error;
  }
}

/**
 * Removes the user from their family. If the owner leaves, ownership moves to the earliest
 * remaining member; if nobody remains, the family (and its invites) is deleted.
 */
export async function leaveFamily(userId: string): Promise<{ left: boolean; familyDeleted: boolean }> {
  return prisma.$transaction(async (tx) => {
    const membership = await tx.familyMember.findUnique({ where: { userId } });
    if (!membership) return { left: false, familyDeleted: false };

    await lockFamily(tx, membership.familyId);
    await tx.familyMember.delete({ where: { userId } });

    const remaining = await tx.familyMember.findMany({
      where: { familyId: membership.familyId },
      orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
    });

    if (remaining.length === 0) {
      await tx.family.delete({ where: { id: membership.familyId } });
      return { left: true, familyDeleted: true };
    }

    const family = await tx.family.findUnique({ where: { id: membership.familyId } });
    // The owner left (or the owner row was already cleared): the earliest member takes over.
    if (family && (family.ownerId === userId || family.ownerId === null)) {
      const heir = remaining[0].userId;
      await tx.family.update({ where: { id: family.id }, data: { ownerId: heir } });
      await tx.familyMember.update({
        where: { familyId_userId: { familyId: family.id, userId: heir } },
        data: { role: "owner" },
      });
    }
    return { left: true, familyDeleted: false };
  });
}

// ---------------------------------------------------------------- reads

export type FamilyMemberInfo = {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  profilePublic: boolean;
  joinedAt: Date;
};

export type FamilyOverview = {
  id: string;
  name: string;
  ownerId: string | null;
  members: FamilyMemberInfo[];
};

export async function getFamilyOverview(familyId: string): Promise<FamilyOverview | null> {
  const family = await prisma.family.findUnique({
    where: { id: familyId },
    include: {
      members: {
        orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
        include: {
          user: {
            select: { handle: true, displayName: true, avatarUrl: true, profilePublic: true },
          },
        },
      },
    },
  });
  if (!family) return null;
  return {
    id: family.id,
    name: family.name,
    ownerId: family.ownerId,
    members: family.members.map((m) => ({
      userId: m.userId,
      handle: m.user.handle,
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      profilePublic: m.user.profilePublic,
      joinedAt: m.joinedAt,
    })),
  };
}

export async function getFamilyOverviewForUser(userId: string): Promise<FamilyOverview | null> {
  const membership = await prisma.familyMember.findUnique({ where: { userId } });
  return membership ? getFamilyOverview(membership.familyId) : null;
}

export type InvitePreview =
  | { status: "ok"; invite: { token: string }; family: FamilyOverview; full: boolean }
  | { status: "expired" | "used" | "not_found" };

/** Read-only look at an invite (for the landing page); does not consume it. */
export async function getInvitePreview(token: string): Promise<InvitePreview> {
  const invite = await prisma.familyInvite.findUnique({ where: { token } });
  if (!invite) return { status: "not_found" };
  if (invite.usedAt) return { status: "used" };
  if (invite.expiresAt.getTime() <= Date.now()) return { status: "expired" };
  const family = await getFamilyOverview(invite.familyId);
  if (!family) return { status: "not_found" };
  return {
    status: "ok",
    invite: { token },
    family,
    full: family.members.length >= MAX_FAMILY_MEMBERS,
  };
}

export type GameCard = {
  id: string;
  slug: string;
  name: string;
  coverUrl: string | null;
  platforms: string[];
  achievementCount: number;
};

export type FamilyLibraryEntry = {
  game: GameCard;
  owners: { handle: string }[];
  /** Member with the most unlocks in this game. `unlocked` is that member's raw count. */
  bestProgress: { handle: string; pct: number; unlocked: number };
};

/** Public members only: a private profile does not contribute its library. */
async function publicMembers(familyId: string): Promise<{ userId: string; handle: string }[]> {
  const members = await prisma.familyMember.findMany({
    where: { familyId, user: { profilePublic: true } },
    orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
    select: { userId: true, user: { select: { handle: true } } },
  });
  return members.map((m) => ({ userId: m.userId, handle: m.user.handle }));
}

export async function getFamilyLibrary(familyId: string): Promise<FamilyLibraryEntry[]> {
  const members = await publicMembers(familyId);
  if (members.length === 0) return [];
  const handleById = new Map(members.map((m) => [m.userId, m.handle]));

  const rows = await prisma.userGame.findMany({
    where: { userId: { in: members.map((m) => m.userId) } },
    include: { game: true },
  });

  const byGame = new Map<string, FamilyLibraryEntry>();
  for (const row of rows) {
    const handle = handleById.get(row.userId);
    if (!handle) continue;
    const { game } = row;
    let entry = byGame.get(game.id);
    if (!entry) {
      entry = {
        game: {
          id: game.id,
          slug: game.slug,
          name: game.name,
          coverUrl: game.coverUrl,
          platforms: game.platforms,
          achievementCount: game.achievementCount,
        },
        owners: [],
        bestProgress: { handle, pct: 0, unlocked: -1 },
      };
      byGame.set(game.id, entry);
    }
    entry.owners.push({ handle });
    const best = entry.bestProgress;
    if (
      row.unlockedCount > best.unlocked ||
      (row.unlockedCount === best.unlocked && handle < best.handle)
    ) {
      entry.bestProgress = {
        handle,
        unlocked: row.unlockedCount,
        pct:
          game.achievementCount > 0
            ? Math.round((row.unlockedCount / game.achievementCount) * 100)
            : 0,
      };
    }
  }

  return [...byGame.values()]
    .map((entry) => ({
      ...entry,
      owners: entry.owners.sort((a, b) => a.handle.localeCompare(b.handle)),
    }))
    .sort((a, b) => a.game.name.localeCompare(b.game.name));
}

/** "Quase lá" da família: unfinished games where the best member is at 70% or more. */
export const ALMOST_THERE_MIN_PCT = 70;

export function almostThere(library: FamilyLibraryEntry[]): FamilyLibraryEntry[] {
  return library
    .filter(
      (e) =>
        e.game.achievementCount > 0 &&
        e.bestProgress.unlocked < e.game.achievementCount &&
        e.bestProgress.pct >= ALMOST_THERE_MIN_PCT,
    )
    .sort((a, b) => b.bestProgress.pct - a.bestProgress.pct);
}

export type FamilyRankingRow = {
  userId: string;
  handle: string;
  displayName: string;
  level: number;
  /** Total XP for the general ranking; skill points for a skill ranking. */
  points: number;
  vocation: string | null;
};

export async function getFamilyRanking(
  familyId: string,
  skill: SkillId | "geral",
): Promise<FamilyRankingRow[]> {
  const members = await prisma.familyMember.findMany({
    where: { familyId, user: { profilePublic: true } },
    select: {
      userId: true,
      user: {
        select: {
          handle: true,
          displayName: true,
          stats: { select: { level: true, totalXp: true, vocation: true } },
        },
      },
    },
  });

  const skillRows =
    skill === "geral" || members.length === 0
      ? []
      : await prisma.skillProgress.findMany({
          where: { skill, userId: { in: members.map((m) => m.userId) } },
        });
  const skillByUser = new Map(skillRows.map((r) => [r.userId, r]));

  const rows = members.map((m): FamilyRankingRow => {
    const { stats } = m.user;
    const progress = skillByUser.get(m.userId);
    return {
      userId: m.userId,
      handle: m.user.handle,
      displayName: m.user.displayName,
      level: (skill === "geral" ? stats?.level : progress?.level) ?? 1,
      points: (skill === "geral" ? stats?.totalXp : progress?.points) ?? 0,
      vocation: stats?.vocation ?? null,
    };
  });

  return rows.sort(
    (a, b) => b.level - a.level || b.points - a.points || a.handle.localeCompare(b.handle),
  );
}
