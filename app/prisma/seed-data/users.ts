import type { SkillId } from "../../src/lib/engine/types";
import { SAMPLE_NAMES, seedPlayerSteamId } from "./sample-names";

/** Handles are stored without the leading "@"; the UI adds it. */
export type SeedUser = {
  handle: string;
  displayName: string;
  steamId: string;
  role: "admin" | "editor" | "author" | "user";
  profilePublic: boolean;
  /** Target general level. */
  level: number;
  /** Target skill levels. */
  skills: Record<SkillId, number>;
};

/** Lucas's preview state (`S.skills`) — also the demo user's exact target. */
export const LUCAS_SKILLS: Record<SkillId, number> = {
  soulslike: 34,
  plataforma: 31,
  rpg: 29,
  roguelike: 27,
  fps: 25,
  horror: 24,
  estrategia: 21,
  coop: 19,
  puzzle: 18,
  simulacao: 12,
  sabio: 8,
};

/** Fractions of the next level already filled (`S.skills[k][1]`). */
export const LUCAS_SKILL_FRACTION: Record<SkillId, number> = {
  soulslike: 0.72,
  plataforma: 0.4,
  rpg: 0.55,
  roguelike: 0.2,
  fps: 0.83,
  horror: 0.1,
  estrategia: 0.66,
  coop: 0.3,
  puzzle: 0.91,
  simulacao: 0.5,
  sabio: 0.2,
};

export const LUCAS_LEVEL = 47;
/** Fraction of level 48's XP gap already earned (preview: 88%). */
export const LUCAS_LEVEL_FRACTION = 0.88;

/**
 * Development-only login of the demo admin (`/entrar`). Documented in the README; never use it
 * outside a local database. The other seeded users have no credentials, like the accounts of the
 * old Steam login (they can be recovered by connecting their Steam, see lib/accounts/steam-link.ts).
 */
export const LUCAS_DEV_LOGIN = { email: "lucas@tralked.dev", password: "tralked-dev-lucas" } as const;

export const LUCAS = {
  handle: "lucas",
  displayName: "Lucas",
  // Same SteamID as the Steam fixture's demo player.
  steamId: "76561198000000000",
  role: "admin" as const,
  profilePublic: true,
  streakCurrent: 12,
  streakBest: 19,
  shields: 1,
};

/** Roles of the seeded players that are not plain users (an editor and an author). */
const ROLES: Record<string, SeedUser["role"]> = { Cronista_Iolanda: "editor", Escriba_Odete: "author" };

/** The preview's ranking players, in ranking order (index i drives the preview's level formula). */
const HANDLES = SAMPLE_NAMES.flatMap((n) =>
  n.kind === "player" ? [{ handle: n.handle, displayName: n.displayName, role: ROLES[n.handle] ?? ("user" as const) }] : [],
);

const SKILL_IDS = Object.keys(LUCAS_SKILLS) as SkillId[];

/**
 * Same formula as the preview ranking: `me + 40 - i * 4 + (i % 3)`.
 * With lucas at 47 this gives levels 87, 84, 81, 75, 72, 69, 63, 60, 57, 51, 48 and 45,
 * so lucas ranks 12th of 13 (eleven players above him, one below).
 */
function offsetFor(i: number): number {
  return 40 - i * 4 + (i % 3);
}

/** Preview VOCATIONS pairs: player i is built around pair i % 7 so vocations vary. */
const VOCATION_PAIRS: [SkillId, SkillId][] = [
  ["soulslike", "plataforma"],
  ["soulslike", "rpg"],
  ["fps", "horror"],
  ["rpg", "estrategia"],
  ["roguelike", "estrategia"],
  ["puzzle", "coop"],
  ["fps", "coop"],
];

export const PLAYERS: SeedUser[] = HANDLES.map(({ handle, displayName, role }, i) => {
  const offset = offsetFor(i);
  const [first, second] = VOCATION_PAIRS[i % VOCATION_PAIRS.length];
  const skills = Object.fromEntries(
    SKILL_IDS.map((id) => [id, Math.max(1, LUCAS_SKILLS[id] + offset)]),
  ) as Record<SkillId, number>;
  // Lucas's best skill is 34, so the pair sits just above that to define the vocation.
  skills[first] = 36 + offset;
  skills[second] = 35 + offset;
  return {
    handle,
    displayName,
    // A valid 17-digit SteamID64 (76561198000001000 + i), like a real Steam account.
    steamId: seedPlayerSteamId(i),
    role,
    profilePublic: true,
    level: LUCAS_LEVEL + offset,
    skills,
  };
});

/** Players who join "Família Lucas" alongside the owner. */
export const FAMILY_MEMBER_HANDLES = ["Cacador_Joaquim", "Herbalista_Rosa"] as const;
