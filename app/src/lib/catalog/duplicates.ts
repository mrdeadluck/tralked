import { prisma } from "@/lib/db";
import { normalizePlatformTitle, normalizeTitle, withoutEdition } from "@/lib/integrations/title-match";

/**
 * Read-only report of catalog games that look like one game stored twice (the same game from
 * Steam, a PSN list, Xbox, IGDB...). It only reads: joining two games is a later, approved step.
 */

export type DuplicateVerdict = "junta" | "nao-junta-steam" | "nao-junta-guia" | "outra-edicao";

export type GameRef = {
  id: string;
  slug: string;
  name: string;
  platforms: string[];
  steamAppId: number | null;
  igdbId: number | null;
  stub: boolean;
  hasGuide: boolean;
  /** Users with the game in their library (any platform). */
  players: number;
};

export type DuplicateGroup = {
  /** The game that stays. */
  keep: GameRef;
  /** The game that would be folded into `keep`. */
  drop: GameRef;
  verdict: DuplicateVerdict;
  reasons: string[];
  /** What a join would move from `drop` to `keep`, by kind (zeros included). */
  moves: Record<string, number>;
  /** In how many groups of the report this `drop` is the dropped game (more than 1: Lucas picks one). */
  dropGroups: number;
  /** In how many groups the `keep` game is itself the dropped game (a chain). */
  keepIsDropIn: number;
  /** The game that stays is a store edition (Complete, GOTY...) and the dropped one is the plain game. */
  keepIsEdition: boolean;
};

type Row = GameRef & { aliases: string[]; searchName: string | null; createdAt: number };
type ListRow = { gameId: string; platform: string; externalId: string; console: string | null; name: string; held: boolean };

/** A platform tag the store puts in the name: `Grand Theft Auto V (PlayStation®5)`. */
const PLATFORM_TAG = /\s*\((?:playstation[®™\s]*\d?|ps\s?[345]|ps vita|xbox[^)]*|pc|windows|steam)\)\s*$/i;

/** Words that make a game another edition, checked on `normalizeTitle` output. */
const OTHER_EDITION_WORDS = ["remastered", "remake", "director s cut", "part i", "definitive"] as const;

/** Trailing words dropped (on `normalizeTitle` output) to find the base game, besides store tiers. */
const EXTRA_SUFFIX = /\s+(?:enhanced(?: edition)?|legacy(?: edition)?|remastered|remake|director s cut|definitive edition|part i|\d{4} edition)$/;

/** The folded name that two games share when they are the same title. */
function nameKey(name: string): string {
  return normalizePlatformTitle(name.replace(PLATFORM_TAG, ""));
}

/** The name without its store edition or "other edition" suffix: the base game's key. */
function baseKey(name: string): string | null {
  const stripped = name.replace(PLATFORM_TAG, "");
  let key = normalizeTitle(withoutEdition(stripped) ?? stripped);
  for (let i = 0; i < 3; i++) key = key.replace(EXTRA_SUFFIX, "");
  return key && key !== normalizeTitle(stripped) ? key : null;
}

function editionWords(name: string): string[] {
  const n = ` ${normalizeTitle(name).replace(/\bremaster\b/g, "remastered")} `;
  return OTHER_EDITION_WORDS.filter((w) => n.includes(` ${w} `));
}

/** Who stays: Steam id, real (not a stub) entry, more players, an IGDB id, the oldest row. */
function rank(a: Row, b: Row): number {
  const first = (x: boolean, y: boolean) => (x === y ? 0 : x ? -1 : 1);
  return (
    first(a.steamAppId !== null, b.steamAppId !== null) ||
    first(!a.stub, !b.stub) ||
    b.players - a.players ||
    first(a.igdbId !== null, b.igdbId !== null) ||
    a.createdAt - b.createdAt ||
    (a.id < b.id ? -1 : 1)
  );
}

export function verdictOf(keep: GameRef, drop: GameRef, sameConsoleLists: boolean): DuplicateVerdict {
  if (keep.steamAppId !== null && drop.steamAppId !== null) return "nao-junta-steam";
  if (keep.hasGuide && drop.hasGuide) return "nao-junta-guia";
  if (editionWords(keep.name).join() !== editionWords(drop.name).join() || sameConsoleLists) return "outra-edicao";
  return "junta";
}

async function loadGames(): Promise<Row[]> {
  const [games, players, guides] = await Promise.all([
    prisma.game.findMany({
      select: { id: true, slug: true, name: true, searchName: true, aliases: true, platforms: true, steamAppId: true, igdbId: true, stub: true, createdAt: true },
    }),
    prisma.$queryRaw<{ gameId: string; n: bigint }[]>`SELECT "gameId", count(DISTINCT "userId") AS n FROM "UserGame" GROUP BY "gameId"`,
    prisma.guide.findMany({ select: { gameId: true } }),
  ]);
  const playerCount = new Map(players.map((p) => [p.gameId, Number(p.n)]));
  const guided = new Set(guides.map((g) => g.gameId));
  return games.map((g) => ({
    id: g.id,
    slug: g.slug,
    name: g.name,
    platforms: g.platforms,
    steamAppId: g.steamAppId,
    igdbId: g.igdbId,
    stub: g.stub,
    hasGuide: guided.has(g.id),
    players: playerCount.get(g.id) ?? 0,
    aliases: g.aliases,
    searchName: g.searchName,
    createdAt: g.createdAt.getTime(),
  }));
}

async function loadLists(): Promise<ListRow[]> {
  return prisma.$queryRaw<ListRow[]>`
    SELECT l."gameId", l.platform, l."externalId", l.console, l.name,
           EXISTS (SELECT 1 FROM "UserTrophyList" u WHERE u."listId" = l.id) AS held
    FROM "TrophyList" l WHERE l.platform <> 'steam'`;
}

const ref = ({ id, slug, name, platforms, steamAppId, igdbId, stub, hasGuide, players }: Row): GameRef => ({
  id, slug, name, platforms, steamAppId, igdbId, stub, hasGuide, players,
});

/**
 * Every column that points at a game, and the `moves` key it counts under. A join moves (or
 * folds) all of them; db test "every column that references a game is counted" reads
 * prisma/schema.prisma and fails when one is missing here.
 */
export const GAME_REFS: { key: string; model: string; column: string }[] = [
  { key: "userGames", model: "UserGame", column: "gameId" },
  { key: "achievements", model: "Achievement", column: "gameId" },
  { key: "trophyLists", model: "TrophyList", column: "gameId" },
  { key: "platformLinks", model: "GamePlatformLink", column: "gameId" },
  { key: "media", model: "GameMedia", column: "gameId" },
  { key: "skills", model: "GameSkill", column: "gameId" },
  { key: "steamPlayers", model: "SteamPlayerCount", column: "gameId" },
  { key: "guides", model: "Guide", column: "gameId" },
  { key: "guideRequests", model: "GuideRequest", column: "gameId" },
  { key: "forumThreads", model: "ForumThread", column: "gameId" },
  { key: "photos", model: "Photo", column: "gameId" },
  { key: "wishlist", model: "WishlistItem", column: "gameId" },
  { key: "articles", model: "ArticleGame", column: "gameId" },
  { key: "articlesLegacy", model: "Article", column: "gameId" },
  { key: "news", model: "ExternalNews", column: "gameId" },
  { key: "releases", model: "GameRelease", column: "gameId" },
  { key: "opens", model: "GameOpen", column: "gameId" },
  { key: "slugRedirects", model: "GameSlugRedirect", column: "gameId" },
  { key: "editions", model: "GameEdition", column: "gameId" },
  { key: "editions", model: "GameEdition", column: "otherId" },
];

/** Counts derived through another table, per game id (`$1` is the list of dropped game ids). */
const DERIVED_QUERIES: Record<string, string> = {
  unlocks: `SELECT a."gameId" AS id, count(*) AS n FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId" WHERE a."gameId" = ANY($1::text[]) GROUP BY 1`,
  undatedUnlocks: `SELECT a."gameId" AS id, count(*) AS n FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId" WHERE a."gameId" = ANY($1::text[]) AND ua."unlockedAt" IS NULL GROUP BY 1`,
  userTrophyLists: `SELECT l."gameId" AS id, count(*) AS n FROM "UserTrophyList" u JOIN "TrophyList" l ON l.id = u."listId" WHERE l."gameId" = ANY($1::text[]) GROUP BY 1`,
  catalogLists: `SELECT l."gameId" AS id, count(*) AS n FROM "TrophyList" l WHERE l."gameId" = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM "UserTrophyList" u WHERE u."listId" = l.id) GROUP BY 1`,
};

const MOVE_KEYS = [...new Set([...GAME_REFS.map((r) => r.key), ...Object.keys(DERIVED_QUERIES)])];
const MOVE_CHUNK = 5000;

async function loadMoves(ids: string[]): Promise<Map<string, Record<string, number>>> {
  const moves = new Map<string, Record<string, number>>(ids.map((id) => [id, {}]));
  // A table of a migration that is not deployed yet (production before the redirects) counts as zero.
  // This is for the read-only REPORT only. The join (D3) must fail hard on a missing table and never
  // treat it as "nothing to move".
  const existing = new Set(
    (await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`).map((t) => t.table_name),
  );
  const queries: { key: string; sql: string }[] = [
    ...GAME_REFS.filter((r) => existing.has(r.model)).map((r) => ({
      key: r.key,
      sql: `SELECT "${r.column}" AS id, count(*) AS n FROM "${r.model}" WHERE "${r.column}" = ANY($1::text[]) GROUP BY 1`,
    })),
    ...Object.entries(DERIVED_QUERIES).map(([key, sql]) => ({ key, sql })),
  ];
  for (let from = 0; from < ids.length; from += MOVE_CHUNK) {
    const chunk = ids.slice(from, from + MOVE_CHUNK);
    for (const { key, sql } of queries) {
      for (const row of await prisma.$queryRawUnsafe<{ id: string; n: bigint }[]>(sql, chunk)) {
        const m = moves.get(row.id);
        if (m) m[key] = (m[key] ?? 0) + Number(row.n);
      }
    }
  }
  for (const m of moves.values()) for (const key of MOVE_KEYS) m[key] ??= 0;
  return moves;
}

/** Every pair of catalog games that may be one game, with the verdict on joining them. Writes nothing. */
export async function findDuplicateCandidates(): Promise<DuplicateGroup[]> {
  const [games, lists] = await Promise.all([loadGames(), loadLists()]);
  const byId = new Map(games.map((g) => [g.id, g]));

  const searchSets = new Map<string, Set<Row>>();
  const nameSets = new Map<string, Set<Row>>();
  const add = (map: Map<string, Set<Row>>, key: string | null | undefined, g: Row) => {
    if (!key) return;
    const bucket = map.get(key);
    if (bucket) bucket.add(g);
    else map.set(key, new Set([g]));
  };
  for (const g of games) {
    add(searchSets, g.searchName, g);
    add(nameSets, nameKey(g.name), g);
  }
  /** Buckets as arrays, the game that would stay first. */
  const ranked = (sets: Map<string, Set<Row>>) => new Map([...sets].map(([k, set]) => [k, [...set].sort(rank)] as const));
  const bySearch = ranked(searchSets);
  const byName = ranked(nameSets);

  // One entry per pair; the same pair found by several rules gathers every reason.
  const pairs = new Map<string, { a: Row; b: Row; reasons: string[] }>();
  const pair = (a: Row, b: Row, reason: string) => {
    if (a.id === b.id) return;
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    const entry = pairs.get(key);
    if (!entry) pairs.set(key, { a, b, reasons: [reason] });
    else if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
  };
  /** A game pairs with the one of the bucket that would stay, not with every sibling. */
  const withBest = (g: Row, bucket: Row[] | undefined, reason: string) => {
    if (!bucket || bucket.includes(g)) return;
    pair(g, bucket[0], reason);
  };

  // 1. Same folded name (the database's own searchName): everyone pairs with the one that stays.
  for (const bucket of [...bySearch.values(), ...byName.values()]) {
    for (const g of bucket.slice(1)) pair(bucket[0], g, "mesmo nome");
  }
  for (const g of games) {
    // 2. Crossed alias: an alias of this game is the name of another.
    for (const alias of g.aliases) {
      const key = nameKey(alias);
      if (key !== nameKey(g.name)) withBest(g, byName.get(key), `apelido "${alias}" é o nome do outro`);
    }
    // 3. Without its store edition, the name is the other's name.
    const base = baseKey(g.name);
    if (base) withBest(g, byName.get(base), "o nome sem a edição é o nome do outro");
  }
  // 4. A PSN/Xbox/RA list sits on one game, but its name is the name of another.
  for (const list of lists) {
    const holder = byId.get(list.gameId);
    if (!holder) continue;
    withBest(holder, byName.get(nameKey(list.name)), `lista ${list.platform.toUpperCase()} ${list.externalId} ("${list.name}") está em ${holder.slug}, mas o nome é o de outro jogo`);
  }

  const consoles = new Map<string, Set<string>>(); // gameId -> "platform:console" of its non-Steam lists
  for (const l of lists) {
    if (!l.console) continue; // any non-Steam list counts, held or a catalog list nobody holds
    const set = consoles.get(l.gameId) ?? new Set<string>();
    set.add(`${l.platform}:${l.console}`);
    consoles.set(l.gameId, set);
  }

  const groups: Omit<DuplicateGroup, "moves" | "dropGroups" | "keepIsDropIn" | "keepIsEdition">[] = [];
  for (const { a, b, reasons } of pairs.values()) {
    const [keep, drop] = rank(a, b) <= 0 ? [a, b] : [b, a];
    const shared = [...(consoles.get(keep.id) ?? [])].filter((c) => consoles.get(drop.id)?.has(c));
    const verdict = verdictOf(ref(keep), ref(drop), shared.length > 0);
    const why = shared.length > 0 ? [...reasons, `os dois têm lista própria no mesmo console (${shared.join(", ")})`] : reasons;
    groups.push({ keep: ref(keep), drop: ref(drop), verdict, reasons: why });
  }

  const moves = await loadMoves([...new Set(groups.map((g) => g.drop.id))]);
  const order: DuplicateVerdict[] = ["junta", "outra-edicao", "nao-junta-guia", "nao-junta-steam"];
  const dropCount = new Map<string, number>();
  for (const g of groups) dropCount.set(g.drop.id, (dropCount.get(g.drop.id) ?? 0) + 1);
  return groups
    .map((g) => ({
      ...g,
      moves: moves.get(g.drop.id) ?? {},
      dropGroups: dropCount.get(g.drop.id) ?? 1,
      keepIsDropIn: dropCount.get(g.keep.id) ?? 0,
      keepIsEdition: withoutEdition(g.keep.name) !== null && withoutEdition(g.drop.name) === null,
    }))
    .sort(
      (x, y) =>
        order.indexOf(x.verdict) - order.indexOf(y.verdict) ||
        y.drop.players - x.drop.players ||
        x.keep.slug.localeCompare(y.keep.slug) ||
        x.drop.slug.localeCompare(y.drop.slug),
    );
}

const VERDICT_TITLE: Record<DuplicateVerdict, { title: string; about: string }> = {
  junta: {
    title: "Podem ser juntados",
    about: 'Mesmo jogo guardado duas vezes. Marque os que você aprova juntar: o jogo da coluna "Sai" vira o da coluna "Fica" e o endereço antigo passa a levar ao novo.',
  },
  "outra-edicao": {
    title: "Parecem outra edição",
    about: 'O nome indica remaster, remake, Director\'s Cut, Parte I ou Definitive, ou os dois têm listas de troféus próprias no mesmo console. Só marque se for mesmo o mesmo jogo; senão eles ficam como "outras edições" um do outro.',
  },
  "nao-junta-guia": {
    title: "Não juntar: os dois têm guia",
    about: "Juntar apagaria um dos guias. Fica só para você saber.",
  },
  "nao-junta-steam": {
    title: "Não juntar: os dois são da Steam",
    about: "Cada jogo da Steam tem seu próprio appid, então nunca se juntam. Fica só para você saber.",
  },
};

/** [singular, plural] of what a join moves. */
const MOVE_LABEL: Record<string, [string, string]> = {
  userGames: ["jogador", "jogadores"],
  achievements: ["conquista", "conquistas"],
  unlocks: ["desbloqueio", "desbloqueios"],
  undatedUnlocks: ["desbloqueio sem data", "desbloqueios sem data"],
  trophyLists: ["lista de troféus", "listas de troféus"],
  userTrophyLists: ["lista com progresso", "listas com progresso"],
  catalogLists: ["lista do catálogo sem dono", "listas do catálogo sem dono"],
  platformLinks: ["ligação de plataforma", "ligações de plataforma"],
  media: ["mídia", "mídias"],
  skills: ["habilidade", "habilidades"],
  steamPlayers: ["contagem de jogadores da Steam", "contagens de jogadores da Steam"],
  guides: ["guia", "guias"],
  guideRequests: ["pedido de guia", "pedidos de guia"],
  forumThreads: ["tópico do fórum", "tópicos do fórum"],
  photos: ["foto", "fotos"],
  wishlist: ["item da lista de desejos", "itens da lista de desejos"],
  articles: ["artigo", "artigos"],
  articlesLegacy: ["artigo (ligação antiga)", "artigos (ligação antiga)"],
  news: ["notícia", "notícias"],
  releases: ["lançamento", "lançamentos"],
  opens: ["abertura", "aberturas"],
  slugRedirects: ["redirecionamento de endereço", "redirecionamentos de endereço"],
  editions: ["par de outras edições", "pares de outras edições"],
};

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function gameCell(g: GameRef): string {
  const steam = g.steamAppId !== null ? `Steam: sim (${g.steamAppId})` : "Steam: não";
  const players = `${g.players} ${g.players === 1 ? "jogador" : "jogadores"}`;
  return cell(`**${g.name}**<br>\`${g.slug}\`<br>${g.platforms.join(", ") || "sem plataforma"} · ${steam}${g.stub ? " · só nome" : ""}<br>${players}`);
}

export function movesCell(moves: Record<string, number>): string {
  const parts = Object.entries(moves)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${MOVE_LABEL[k]?.[n === 1 ? 0 : 1] ?? k}`);
  return parts.length > 0 ? parts.join(", ") : "nada";
}

/** Something a person would miss after a join: players, progress, a guide, posts. */
const CONTENT_MOVES = ["userGames", "userTrophyLists", "unlocks", "guides", "forumThreads", "photos", "wishlist", "articles"];
export const hasContent = (g: DuplicateGroup) => g.drop.players > 0 || CONTENT_MOVES.some((k) => (g.moves[k] ?? 0) > 0);

const lightCell = (g: GameRef) => cell(`\`${g.slug}\` (${g.name}; ${g.steamAppId !== null ? "Steam" : "sem Steam"})`);

/** What Lucas must look at before approving the row. */
function notes(g: DuplicateGroup): string[] {
  const out: string[] = [];
  if (g.dropGroups > 1) out.push(`este jogo sai em ${g.dropGroups} grupos: escolha um`);
  if (g.keepIsDropIn > 0) out.push("o jogo que fica também sai em outro grupo");
  if (g.keepIsEdition) out.push("fica a edição; confira");
  return out;
}

const reasonsCell = (g: DuplicateGroup) => cell([...g.reasons, ...notes(g).map((n) => `**${n}**`)].join("; "));

/** The report for Lucas to review: pt-BR, one table per verdict, a checkbox per row to approve. */
export function renderMarkdown(groups: DuplicateGroup[], date: string): string {
  const verdicts = Object.keys(VERDICT_TITLE) as DuplicateVerdict[];
  const out: string[] = [
    `# Jogos duplicados: candidatos (${date})`,
    "",
    'Relatório só de leitura: nada foi alterado no banco. Em cada tabela, "Fica" é o jogo que continua e "Sai" é o que seria juntado a ele.',
    "Marque `[x] juntar` nas linhas que você aprova. Os grupos sem jogadores nem conteúdo para mover ficam recolhidos no fim de cada seção.",
    "",
    "## Resumo",
    "",
    "| Veredito | Grupos | Com jogadores ou conteúdo |",
    "| --- | ---: | ---: |",
    ...verdicts.map((v) => {
      const rows = groups.filter((g) => g.verdict === v);
      return `| ${VERDICT_TITLE[v].title} | ${rows.length} | ${rows.filter(hasContent).length} |`;
    }),
    "",
  ];
  for (const verdict of verdicts) {
    const rows = groups.filter((g) => g.verdict === verdict);
    out.push(`## ${VERDICT_TITLE[verdict].title} (${rows.length})`, "", VERDICT_TITLE[verdict].about, "");
    if (rows.length === 0) {
      out.push("Nenhum.", "");
      continue;
    }
    const approvable = verdict === "junta" || verdict === "outra-edicao";
    const box = approvable ? "[ ] juntar" : "não junta";
    const heavy = rows.filter(hasContent);
    const light = rows.filter((g) => !hasContent(g));
    if (heavy.length > 0) {
      out.push(`### Com jogadores ou conteúdo para mover (${heavy.length})`, "");
      out.push("| Fica | Sai | Motivos | Vai mover | Aprovo |", "| --- | --- | --- | --- | --- |");
      for (const g of heavy) {
        out.push(`| ${gameCell(g.keep)} | ${gameCell(g.drop)} | ${reasonsCell(g)} | ${cell(movesCell(g.moves))} | ${box} |`);
      }
      out.push("");
    }
    if (light.length > 0) {
      out.push(`<details><summary>Sem jogadores nem conteúdo para mover: ${light.length} grupos (abrir a lista)</summary>`, "");
      if (approvable) {
        out.push("| Fica | Sai | Motivos | Vai mover | Aprovo |", "| --- | --- | --- | --- | --- |");
        for (const g of light) {
          out.push(`| ${lightCell(g.keep)} | ${lightCell(g.drop)} | ${reasonsCell(g)} | ${cell(movesCell(g.moves))} | ${box} |`);
        }
      } else {
        for (const g of light) out.push(`- ${lightCell(g.keep)} e ${lightCell(g.drop)}`);
      }
      out.push("", "</details>", "");
    }
  }
  return out.join("\n");
}
