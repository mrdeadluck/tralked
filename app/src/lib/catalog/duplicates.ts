import { prisma } from "@/lib/db";
import { normalizePlatformTitle, normalizeTitle, withoutEdition } from "@/lib/integrations/title-match";

/**
 * Read-only report of catalog games that look like one game stored twice (the same game from
 * Steam, a PSN list, Xbox, IGDB...). It only reads: joining two games is a later, approved step.
 */

/**
 * junta: joined automatically (no review). outra-edicao: separate games linked as "Outras edições".
 * nao-junta-steam / nao-junta-guia: never joined. revisar: Lucas decides. placeholder: a catalog
 * placeholder with nothing to move; never joined in this phase.
 */
export type DuplicateVerdict = "junta" | "outra-edicao" | "nao-junta-steam" | "nao-junta-guia" | "revisar" | "placeholder";

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
type ListRow = { gameId: string; platform: string; externalId: string; console: string | null; name: string; conceptId: number | null };
type LinkRow = { gameId: string; platform: string; externalId: string };

/** What the database says about the two games' lists, used to pick the verdict. */
export type PairFacts = {
  /** Same-list evidence: a shared PSN concept, or a list of one game that is the other's platform link. */
  sameList: boolean;
  /** Both games have a TrophyList on the same platform + console. */
  sharedConsole: boolean;
};

/** A platform tag the store puts in the name: `Grand Theft Auto V (PlayStation®5)`. */
const PLATFORM_TAG = /\s*\((?:playstation[®™\s]*\d?|ps\s?[345]|ps vita|xbox[^)]*|pc|windows|steam)\)\s*$/i;

/** Words that make a game another edition, checked on `normalizeTitle` output. */
const OTHER_EDITION_WORDS = ["remastered", "remake", "director s cut", "part i", "definitive", "enhanced", "legacy", "anniversary"] as const;

/** Trailing words dropped (on `normalizeTitle` output) to find the base game, besides store tiers. */
const EXTRA_SUFFIX = /\s+(?:enhanced(?: edition)?|legacy(?: edition)?|remastered|remake|director s cut|definitive edition|anniversary(?: edition)?|part i|\d{4} edition)$/;

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

/** The name without store-tier words (Deluxe, GOTY, Complete, Edition...) and platform tags. */
function storeKey(name: string): string {
  const stripped = name.replace(PLATFORM_TAG, "");
  return nameKey(withoutEdition(stripped) ?? stripped);
}

/**
 * The verdict of a pair before content is looked at:
 * 1. both with a Steam appid -> nao-junta-steam; both with a guide -> nao-junta-guia;
 * 2. same-list evidence (shared PSN concept, one game's list is the other's platform link) -> junta;
 * 3. a list on the same platform + console on both, or remaster words (Remastered, Remake,
 *    Director's Cut, Enhanced, Legacy, Definitive, Part I, Anniversary) on only one -> outra-edicao;
 * 4. equal names once store-tier words are removed -> junta (the same game on other platforms);
 * 5. anything else -> revisar.
 */
export function verdictOf(keep: GameRef, drop: GameRef, facts: PairFacts): DuplicateVerdict {
  if (keep.steamAppId !== null && drop.steamAppId !== null) return "nao-junta-steam";
  if (keep.hasGuide && drop.hasGuide) return "nao-junta-guia";
  if (facts.sameList) return "junta";
  if (facts.sharedConsole || editionWords(keep.name).join() !== editionWords(drop.name).join()) return "outra-edicao";
  if (storeKey(keep.name) === storeKey(drop.name)) return "junta";
  return "revisar";
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
    SELECT l."gameId", l.platform, l."externalId", l.console, l.name, l."conceptId"
    FROM "TrophyList" l WHERE l.platform <> 'steam'`;
}

/** Platform ids (PSN lists and store ids, Xbox titleIds, RA game ids) linked to a game. */
async function loadLinks(): Promise<LinkRow[]> {
  return prisma.$queryRaw<LinkRow[]>`SELECT "gameId", platform, "externalId" FROM "GamePlatformLink" WHERE platform <> 'steam'`;
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
  { key: "igdbAliases", model: "GameIgdbAlias", column: "gameId" },
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
  const [games, lists, links] = await Promise.all([loadGames(), loadLists(), loadLinks()]);
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

  // 5. Same PSN concept (regional and console lists of one game): everyone pairs with the one that stays.
  const byConcept = new Map<number, Set<Row>>();
  for (const l of lists) {
    const holder = byId.get(l.gameId);
    if (l.conceptId == null || !holder) continue;
    const set = byConcept.get(l.conceptId);
    if (set) set.add(holder);
    else byConcept.set(l.conceptId, new Set([holder]));
  }
  for (const [concept, set] of byConcept) {
    if (set.size < 2) continue;
    const bucket = [...set].sort(rank);
    for (const g of bucket.slice(1)) pair(bucket[0], g, `mesmo conceito PSN (${concept})`);
  }
  // 6. A list of one game is a platform link of another (PSN list, Xbox titleId, RA game id).
  const listKey = (platform: string, externalId: string) => `${platform}:${externalId}`;
  const linksOf = new Map<string, Set<string>>(); // gameId -> keys of its platform links
  const linkOwner = new Map<string, string>();
  for (const l of links) {
    const key = listKey(l.platform, l.externalId);
    linkOwner.set(key, l.gameId);
    const set = linksOf.get(l.gameId) ?? new Set<string>();
    set.add(key);
    linksOf.set(l.gameId, set);
  }
  for (const list of lists) {
    const holder = byId.get(list.gameId);
    const other = byId.get(linkOwner.get(listKey(list.platform, list.externalId)) ?? "");
    if (holder && other) pair(holder, other, `a lista ${list.externalId} está em ${holder.slug} e ligada a ${other.slug}`);
  }

  // Per game: the platform + console of its lists, its PSN concepts and the keys of its lists.
  const consoles = new Map<string, Set<string>>();
  const concepts = new Map<string, Set<number>>();
  const listKeys = new Map<string, Set<string>>();
  const put = <T>(map: Map<string, Set<T>>, gameId: string, value: T) => {
    const set = map.get(gameId);
    if (set) set.add(value);
    else map.set(gameId, new Set([value]));
  };
  for (const l of lists) {
    if (l.console) put(consoles, l.gameId, `${l.platform}:${l.console}`); // held or a catalog list nobody holds
    if (l.conceptId != null) put(concepts, l.gameId, l.conceptId);
    put(listKeys, l.gameId, listKey(l.platform, l.externalId));
  }
  const sharedOf = <T>(map: Map<string, Set<T>>, a: string, b: string): T[] => [...(map.get(a) ?? [])].filter((v) => map.get(b)?.has(v));
  const linkedTo = (holder: string, owner: string) => [...(listKeys.get(holder) ?? [])].some((k) => linksOf.get(owner)?.has(k));

  type Draft = { keep: Row; drop: Row; verdict: DuplicateVerdict; reasons: string[] };
  const drafts: Draft[] = [];
  for (const { a, b, reasons } of pairs.values()) {
    let [keep, drop] = rank(a, b) <= 0 ? [a, b] : [b, a];
    const sharedConcepts = sharedOf(concepts, keep.id, drop.id);
    const sameList = sharedConcepts.length > 0 || linkedTo(keep.id, drop.id) || linkedTo(drop.id, keep.id);
    const sharedConsoles = sharedOf(consoles, keep.id, drop.id);
    const verdict = verdictOf(ref(keep), ref(drop), { sameList, sharedConsole: sharedConsoles.length > 0 });
    const why = [...reasons];
    if (sameList) why.push("mesma lista ou mesmo conceito PSN nos dois jogos");
    if (sharedConsoles.length > 0) why.push(`os dois têm lista no mesmo console (${sharedConsoles.join(", ")})`);
    // The plain game's slug survives: an edition is never the game that stays in a join.
    if (verdict === "junta" && isEditionOf(keep, drop)) [keep, drop] = [drop, keep];
    drafts.push({ keep, drop, verdict, reasons: why });
  }

  const moves = await loadMoves([...new Set(drafts.map((d) => d.drop.id))]);
  type Final = Omit<DuplicateGroup, "dropGroups" | "keepIsDropIn" | "keepIsEdition">;
  let finals: Final[] = drafts.map((d) => ({ keep: ref(d.keep), drop: ref(d.drop), verdict: d.verdict, reasons: d.reasons, moves: moves.get(d.drop.id) ?? {} }));
  // A catalog placeholder (nothing a player would miss) is never joined in this phase.
  for (const g of finals) {
    if ((g.verdict === "junta" || g.verdict === "revisar") && !hasContent(g)) g.verdict = "placeholder";
  }

  // A game dropped in 2+ joins goes to review; so do the pairs of a chain once the family has one canonical keep.
  const rows = new Map(games.map((g) => [g.id, g]));
  const joins = () => finals.filter((g) => g.verdict === "junta");
  const dropsSeen = new Map<string, number>();
  for (const g of joins()) dropsSeen.set(g.drop.id, (dropsSeen.get(g.drop.id) ?? 0) + 1);
  for (const g of joins()) {
    const n = dropsSeen.get(g.drop.id) ?? 0;
    if (n > 1) {
      g.verdict = "revisar";
      g.reasons.push(`este jogo sairia em ${n} juntas automáticas: escolha com qual juntar`);
    }
  }
  const dropIds = new Set(joins().map((g) => g.drop.id));
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const g of joins()) parent.set(find(g.keep.id), find(g.drop.id));
  const families = new Map<string, Final[]>();
  for (const g of joins()) {
    const root = find(g.keep.id);
    families.set(root, [...(families.get(root) ?? []), g]);
  }
  for (const family of families.values()) {
    if (!family.some((g) => dropIds.has(g.keep.id))) continue; // no chain
    const members = new Map<string, Row>();
    for (const g of family) for (const id of [g.keep.id, g.drop.id]) members.set(id, rows.get(id)!);
    const canonical = [...members.values()].sort(rank)[0];
    for (const g of family) {
      if (g.keep.id === canonical.id) continue;
      g.verdict = "revisar";
      g.reasons.push(`cadeia de juntas: o jogo canônico da família seria ${canonical.slug}`);
    }
  }

  const dropCount = new Map<string, number>();
  for (const g of finals) dropCount.set(g.drop.id, (dropCount.get(g.drop.id) ?? 0) + 1);
  const order: DuplicateVerdict[] = ["revisar", "junta", "outra-edicao", "nao-junta-guia", "nao-junta-steam", "placeholder"];
  finals = finals.sort(
    (x, y) =>
      order.indexOf(x.verdict) - order.indexOf(y.verdict) ||
      y.drop.players - x.drop.players ||
      x.keep.slug.localeCompare(y.keep.slug) ||
      x.drop.slug.localeCompare(y.drop.slug),
  );
  return finals.map((g) => ({
    ...g,
    dropGroups: dropCount.get(g.drop.id) ?? 1,
    keepIsDropIn: dropCount.get(g.keep.id) ?? 0,
    keepIsEdition: isEditionOf(g.keep, g.drop),
  }));
}

/** The first is a store edition (Complete, GOTY, Deluxe...) and the second is the plain game. */
function isEditionOf(edition: { name: string }, plain: { name: string }): boolean {
  return withoutEdition(edition.name) !== null && withoutEdition(plain.name) === null;
}

const VERDICT_TITLE: Record<DuplicateVerdict, { title: string; about: string }> = {
  revisar: {
    title: "Para você decidir",
    about: 'Casos que a regra automática não resolve (nomes diferentes, o mesmo jogo a sair em mais de uma junta, cadeias). Marque `[x] juntar` nos que você aprova: o jogo da coluna "Sai" vira o da coluna "Fica" e o endereço antigo passa a levar ao novo.',
  },
  junta: {
    title: "Juntas automáticas",
    about: "Mesma lista ou mesmo conceito PSN, ou o mesmo nome (sem Deluxe, GOTY, Complete...) em plataformas diferentes sem lista no mesmo console. Não precisa revisar: são juntadas na fase seguinte.",
  },
  "outra-edicao": {
    title: "Outras edições (automático)",
    about: 'Continuam jogos separados e passam a se ligar em "Outras edições": os dois têm lista no mesmo console, ou o nome indica remaster, remake, Director\'s Cut, Enhanced, Legacy, Definitive, Parte I ou Anniversary.',
  },
  "nao-junta-guia": {
    title: "Não juntar: os dois têm guia",
    about: "Juntar apagaria um dos guias. Fica só para você saber.",
  },
  "nao-junta-steam": {
    title: "Não juntar: os dois são da Steam",
    about: "Cada jogo da Steam tem seu próprio appid, então nunca se juntam. Fica só para você saber.",
  },
  placeholder: {
    title: "Entradas vazias do catálogo",
    about: "Sem jogadores nem conteúdo para mover. Não são juntadas nesta fase.",
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
export const hasContent = (g: Pick<DuplicateGroup, "drop" | "moves">) => g.drop.players > 0 || CONTENT_MOVES.some((k) => (g.moves[k] ?? 0) > 0);

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

/** The report for Lucas: what he must decide first, then what the rules do by themselves. */
export function renderMarkdown(groups: DuplicateGroup[], date: string): string {
  const verdicts = Object.keys(VERDICT_TITLE) as DuplicateVerdict[];
  const of = (v: DuplicateVerdict) => groups.filter((g) => g.verdict === v);
  const total = (list: DuplicateGroup[]) => {
    const sum: Record<string, number> = {};
    for (const g of list) for (const [k, n] of Object.entries(g.moves)) sum[k] = (sum[k] ?? 0) + n;
    return movesCell(sum);
  };
  const out: string[] = [
    `# Jogos duplicados: candidatos (${date})`,
    "",
    'Relatório só de leitura: nada foi alterado no banco. Em cada tabela, "Fica" é o jogo que continua e "Sai" é o que seria juntado a ele.',
    'Você só precisa revisar a primeira seção, "Para você decidir". O resto as regras resolvem sozinhas.',
    "",
    "## Resumo",
    "",
    "| Veredito | Grupos | Com jogadores ou conteúdo |",
    "| --- | ---: | ---: |",
    ...verdicts.map((v) => `| ${VERDICT_TITLE[v].title} | ${of(v).length} | ${of(v).filter(hasContent).length} |`),
    "",
  ];
  const full = (list: DuplicateGroup[], box: string) => {
    out.push("| Fica | Sai | Motivos | Vai mover | Aprovo |", "| --- | --- | --- | --- | --- |");
    for (const g of list) {
      out.push(`| ${gameCell(g.keep)} | ${gameCell(g.drop)} | ${reasonsCell(g)} | ${cell(movesCell(g.moves))} | ${box} |`);
    }
    out.push("");
  };
  const compact = (list: DuplicateGroup[], withMoves: boolean) => {
    out.push(
      withMoves ? "| Fica | Sai | Vai mover |" : "| Fica | Sai |",
      withMoves ? "| --- | --- | --- |" : "| --- | --- |",
    );
    for (const g of list) {
      const n = notes(g);
      out.push(`| ${lightCell(g.keep)} | ${lightCell(g.drop)}${n.length > 0 ? cell(` — **${n.join("; ")}**`) : ""} |${withMoves ? ` ${cell(movesCell(g.moves))} |` : ""}`);
    }
    out.push("");
  };
  const collapsed = (title: string, list: DuplicateGroup[], withMoves: boolean) => {
    if (list.length === 0) return;
    out.push(`<details><summary>${title}: ${list.length} grupos (abrir a lista)</summary>`, "");
    compact(list, withMoves);
    out.push("</details>", "");
  };

  for (const verdict of verdicts) {
    const rows = of(verdict);
    out.push(`## ${VERDICT_TITLE[verdict].title} (${rows.length})`, "", VERDICT_TITLE[verdict].about, "");
    if (rows.length === 0) {
      out.push("Nenhum.", "");
      continue;
    }
    if (verdict === "revisar") {
      full(rows, "[ ] juntar");
    } else if (verdict === "junta" || verdict === "outra-edicao") {
      out.push(`Total que se move: ${cell(total(rows))}.`, "");
      const heavy = rows.filter(hasContent);
      if (heavy.length > 0) compact(heavy, true);
      collapsed("Sem jogadores nem conteúdo", rows.filter((g) => !hasContent(g)), true);
    } else if (verdict === "placeholder") {
      collapsed("Entradas vazias", rows, false);
    } else {
      const heavy = rows.filter(hasContent);
      if (heavy.length > 0) compact(heavy, false);
      collapsed("Sem jogadores nem conteúdo", rows.filter((g) => !hasContent(g)), false);
    }
  }
  return out.join("\n");
}
