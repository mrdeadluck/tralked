import type { GuidePayloadV2 } from "./contract.js";
import { UNPLACED_MARK, type DossierItem, type GuideDossier } from "./dossier.js";
import type { RobotReport } from "./report.js";
import type { GuideSkeleton } from "./skeleton.js";

/**
 * The site's limits on a guide (app/src/lib/content/walkthrough-schema.ts and the 1 MiB body cap of
 * app/src/lib/api/write.ts), checked before any money goes into writing, and again on the final body.
 */
export const SITE_LIMITS = { chapters: 60, stepsPerChapter: 80, itemsPerStep: 40, bodyBytes: 1024 * 1024 } as const;

/** Bytes of a JSON body as the site counts them. */
export const bodyBytes = (body: unknown) => Buffer.byteLength(JSON.stringify(body), "utf8");

export const kib = (bytes: number) => Math.ceil(bytes / 1024);

/** Room kept in the body for the report's last notes when images are sized on the written guide. */
export const REPORT_SLACK_BYTES = 4096;

/**
 * Which items get an image first, once the guide is written and its real size known: missables, then collectibles
 * that count toward an achievement, then the rest; each group in route order.
 */
export function imageOrder<T extends { missable: boolean; countsFor: string[] }>(chapters: { steps: { items: T[] }[] }[]): T[] {
  const route = chapters.flatMap((c) => c.steps.flatMap((s) => s.items));
  const rank = (i: T) => (i.missable ? 0 : i.countsFor.length > 0 ? 1 : 2);
  return route.map((item, at) => ({ item, at })).sort((a, b) => rank(a.item) - rank(b.item) || a.at - b.at).map((x) => x.item);
}

/** What one image adds to the body, given its credit texts (the uploaded URL counted at its longest usual size). */
export function imageBytes(image: { credit: string; sourceName: string; sourceUrl?: string }): number {
  return bodyBytes({ image: { url: `https://${"x".repeat(110)}`, ...image } }) - 2;
}

/** One Portuguese sentence per site limit the skeleton breaks; empty when it fits. */
export function skeletonLimitProblems(skel: GuideSkeleton): string[] {
  const problems: string[] = [];
  if (skel.chapters.length > SITE_LIMITS.chapters) {
    problems.push(`O guia teria ${skel.chapters.length} capítulos; o site aceita até ${SITE_LIMITS.chapters}.`);
  }
  for (const c of skel.chapters) {
    if (c.steps.length > SITE_LIMITS.stepsPerChapter) {
      problems.push(`O capítulo "${c.title}" teria ${c.steps.length} passos; o site aceita até ${SITE_LIMITS.stepsPerChapter}.`);
    }
    for (const s of c.steps) {
      if (s.items.length > SITE_LIMITS.itemsPerStep) {
        problems.push(`O passo ${s.key} teria ${s.items.length} itens; o site aceita até ${SITE_LIMITS.itemsPerStep}.`);
      }
    }
  }
  return problems;
}

/** Text the model writes per step (1 to 3 short paragraphs, the warnings) and per item (`local`), in bytes. */
const STEP_TEXT_BYTES = 350;
const ITEM_TEXT_BYTES = 220;
/** An item's image: url, credit, source name and url. */
export const IMAGE_BYTES = 380;
/** Cover, ficha, overview, "read first", soundtrack. */
const FRAME_BYTES = 12_000;
const PHASE_BYTES = 2_500;

function itemBytes(key: string, item: DossierItem | null, achievement: string | undefined): number {
  const planned = {
    key,
    kind: "collectible",
    name: item?.nameEn ?? item?.name ?? achievement ?? "",
    nameEn: item?.nameEn ?? "",
    collectibleType: item?.collectibleType ?? "",
    index: item?.index,
    total: item?.total,
    missable: false,
    returnLater: false,
    spoiler: false,
    achievement,
    countsFor: item?.countsFor ?? [],
    alsoOn: [],
    sources: (item?.sourceLinks ?? []).slice(0, 10),
    review: false,
  };
  return bodyBytes(planned) + ITEM_TEXT_BYTES;
}

/**
 * The guide body's size before writing, from the skeleton: every item as the writer will send it, an allowance for
 * the model's text, the roadmap and the frame, plus `extraBytes` (the report). With and without item images.
 */
export function estimatePayloadBytes(skel: GuideSkeleton, dossier: GuideDossier, extraBytes = 0): { withoutImages: number; withImages: number } {
  let bytes = FRAME_BYTES + skel.phases.length * PHASE_BYTES + extraBytes;
  let items = 0;
  for (const c of skel.chapters) {
    bytes += 300;
    for (const s of c.steps) {
      bytes += STEP_TEXT_BYTES;
      for (const i of s.items) {
        bytes += itemBytes(i.key, i.item, i.ach?.apiName);
        items++;
      }
    }
  }
  // The roadmap lists every achievement; the guide credits every source page.
  bytes += dossier.achievements.length * 40;
  bytes += new Set(dossier.chapters.flatMap((c) => c.items.flatMap((i) => i.sourceLinks.map((l) => l.url)))).size * 200;
  return { withoutImages: bytes, withImages: bytes + items * IMAGE_BYTES };
}

type Body = Partial<GuidePayloadV2> & { walkthrough?: GuidePayloadV2["walkthrough"]; report: RobotReport };
const LIST_KEEP = 20;

/** The first lines of a long list; lines with `pinned` (the R30 warnings) always stay. */
function trimList(list: string[], pinned?: string): string[] {
  if (list.length <= LIST_KEEP) return list;
  const keep = pinned ? list.filter((l) => l.includes(pinned)) : [];
  const rest = list.filter((l) => !keep.includes(l));
  const room = Math.max(0, LIST_KEEP - keep.length);
  const cut = rest.length - room;
  return [...keep, ...rest.slice(0, room), ...(cut > 0 ? [`(e mais ${cut})`] : [])];
}

/**
 * The body under the site's cap: as is when it fits; else without the item images (optional), then with the
 * report's long lists cut. Never touches the guide's text. `dropped` says what went, for the report.
 */
export function fitBody<T extends Body>(body: T): { ok: true; body: T; bytes: number; dropped: string[] } | { ok: false; bytes: number } {
  let current = body;
  let bytes = bodyBytes(current);
  const dropped: string[] = [];
  if (bytes <= SITE_LIMITS.bodyBytes) return { ok: true, body: current, bytes, dropped };

  // Item images, a few at a time from the end of the route back, only as many as needed.
  if (current.walkthrough?.chapters.some((c) => c.steps.some((s) => s.items.some((i) => i.image)))) {
    const walkthrough = structuredClone(current.walkthrough);
    current = { ...current, walkthrough };
    const withImage = walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items)).filter((i) => i.image);
    let removed = 0;
    while (bytes > SITE_LIMITS.bodyBytes && withImage.length > 0) {
      const item = withImage.pop()!;
      // ',"image":{...}' leaves the item.
      bytes -= Buffer.byteLength(`,"image":${JSON.stringify(item.image)}`, "utf8");
      delete item.image;
      removed++;
      if (bytes <= SITE_LIMITS.bodyBytes) bytes = bodyBytes(current);
    }
    bytes = bodyBytes(current);
    dropped.push(`${removed} ${removed === 1 ? "imagem de item ficou" : "imagens de itens ficaram"} de fora, do fim da rota para o começo, para o guia caber em ${kib(SITE_LIMITS.bodyBytes)} KiB`);
    if (bytes <= SITE_LIMITS.bodyBytes) return { ok: true, body: current, bytes, dropped };
  }

  const report = current.report;
  const unplaced = report.unplaced;
  if (report.divergences.length > LIST_KEEP || report.singleSource.length > LIST_KEEP || (unplaced?.items.length ?? 0) > LIST_KEEP) {
    current = {
      ...current,
      report: {
        ...report,
        divergences: trimList(report.divergences, UNPLACED_MARK),
        singleSource: trimList(report.singleSource),
        ...(unplaced && unplaced.items.length > LIST_KEEP
          ? {
              unplaced: {
                ...unplaced,
                // Missables first: they are the ones an editor must see.
                items: [...unplaced.items.filter((i) => i.missable), ...unplaced.items.filter((i) => !i.missable)].slice(0, LIST_KEEP),
                omitted: unplaced.items.length - LIST_KEEP + (unplaced.omitted ?? 0),
              },
            }
          : {}),
      },
    };
    dropped.push(`o relatório cortou as listas de divergências, de fonte única e de itens não posicionados em ${LIST_KEEP} linhas cada`);
    bytes = bodyBytes(current);
    if (bytes <= SITE_LIMITS.bodyBytes) return { ok: true, body: current, bytes, dropped };
  }
  return { ok: false, bytes };
}

/** The failure reason when the guide does not fit the site. */
export const tooBigReason = (bytes: number) =>
  `o guia ficaria com ${kib(bytes)} KiB e o site aceita até ${kib(SITE_LIMITS.bodyBytes)} KiB (1 MiB) por envio`;
