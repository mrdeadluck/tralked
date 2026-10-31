/**
 * Fictional people of the development data: invented pt-BR RPG-NPC names (never handles of real
 * people online). `previous` is the name the same seeded character had before Plano 4; the seed
 * uses `handle`/`displayName`, and `scripts/rename-sample-users.ts` renames an existing database
 * from `previous` to `handle`.
 *
 * `player` entries are seeded users (index = their place in the seed's ranking, which also fixes
 * their SteamID `76561198000001<index>`); `author` entries are news bylines without an account.
 * The real accounts (`lucas`, the demo admin; MrDead_, Diguzz) are not in this list.
 */
export type SampleName = {
  previous: string;
  handle: string;
  displayName: string;
} & ({ kind: "player"; index: number } | { kind: "author" });

export const SAMPLE_NAMES: readonly SampleName[] = [
  { kind: "player", index: 0, previous: "BillyButcher", handle: "Ferreiro_Bastiao", displayName: "Ferreiro Bastião" },
  { kind: "player", index: 1, previous: "ZeroJimmy", handle: "Escudeiro_Tadeu", displayName: "Escudeiro Tadeu" },
  { kind: "player", index: 2, previous: "MotocaGamer", handle: "Mercador_Anselmo", displayName: "Mercador Anselmo" },
  { kind: "player", index: 3, previous: "Fuyushiro", handle: "Cronista_Iolanda", displayName: "Cronista Iolanda" },
  { kind: "player", index: 4, previous: "urso", handle: "Lenhador_Bento", displayName: "Lenhador Bento" },
  { kind: "player", index: 5, previous: "Nyx_Vortex", handle: "Escriba_Odete", displayName: "Escriba Odete" },
  { kind: "player", index: 6, previous: "KairoBR", handle: "Cacador_Joaquim", displayName: "Caçador Joaquim" },
  { kind: "player", index: 7, previous: "ValkyrieZero", handle: "Guardia_Selene", displayName: "Guardiã Selene" },
  { kind: "player", index: 8, previous: "LunaDeFerro", handle: "Herbalista_Rosa", displayName: "Herbalista Rosa" },
  { kind: "player", index: 9, previous: "b0ltz", handle: "Barqueiro_Tobias", displayName: "Barqueiro Tobias" },
  { kind: "player", index: 10, previous: "Pixelmancer", handle: "Alquimista_Damiao", displayName: "Alquimista Damião" },
  { kind: "player", index: 11, previous: "Morrigan77", handle: "Taverneira_Gerta", displayName: "Taverneira Gerta" },
  { kind: "author", previous: "Rivia", handle: "Arauto_Leopoldo", displayName: "Arauto Leopoldo" },
  { kind: "author", previous: "Al1enado", handle: "Bardo_Quiteria", displayName: "Bardo Quitéria" },
  { kind: "author", previous: "NascimentoRE", handle: "Vigia_Custodio", displayName: "Vigia Custódio" },
];

/** SteamID64 of the seeded player at `index` in the ranking (a valid 17-digit id). */
export const seedPlayerSteamId = (index: number) => `76561198000001${String(index).padStart(3, "0")}`;
