import { itemRef } from "@/lib/content/walk-refs";
import { INLINE_SPOILER, type ContentBlock } from "@/lib/content/schema";
import type { Walkthrough, WalkItem, WalkItemKind } from "@/lib/content/walkthrough-schema";
import type { WalkAchievementView, WalkExtras } from "@/lib/queries/games";

/*
 * What the walkthrough page renders, with every spoiler taken out (R13, R16): notes, step callouts
 * and items marked `spoiler`, and items of hidden Steam achievements, become placeholders, and gated
 * items travel under an opaque ref. Inline `||spoiler||` spans of the remaining text become their
 * index (`||0||`, `||1||`…): the page draws a gate there (inline.tsx) whose text arrives on reveal,
 * keyed `<scope>#<index>` (spanKey). Their text comes back only through revealWalkSpoilers, built
 * from the same walkthrough by `walkSpoilers` below, so masking and revealing stay symmetric.
 * Server only in practice: it reads the full walkthrough.
 */

/** A Steam achievement as the page shows it: never its apiName (it often spells the name). */
export type AchView = Omit<WalkAchievementView, "apiName" | "done">;

export type ItemSource = { name: string; url: string | null };
export type ItemImage = { url: string; credit: string; sourceName: string; sourceUrl: string | null };

export type ItemView = {
  /** The item key, or an opaque ref while it is gated (lib/content/walk-refs). */
  ref: string;
  kind: WalkItemKind;
  /** Behind the spoiler gate: name, location, image and source links come on reveal. */
  gated: boolean;
  /** Null while gated. */
  name: string | null;
  nameEn: string | null;
  collectibleType: string | null;
  index: number | null;
  total: number | null;
  location: string | null;
  missable: boolean;
  returnLater: boolean;
  alsoOn: ("psn" | "xbox")[];
  image: ItemImage | null;
  sources: ItemSource[];
  review: boolean;
  achievement: AchView | null;
};

/** A body block, or a spoiler callout reduced to its id (the text comes on reveal). */
export type BlockView = ContentBlock | { type: "spoiler"; id: string };

export type StepView = {
  number: string;
  /** Prefix of the span scopes of the step's blocks (`chapter.step`): block `b` is `${scope}.${b}`. */
  scope: string;
  body: BlockView[];
  items: ItemView[];
};

export type ChapterView = {
  key: string;
  /** 1-based number of the roadmap phase the chapter belongs to (0 when it names none). */
  phase: number;
  title: string;
  region: string | null;
  hours: string;
  sceneImage: string | null;
  /** Masked like step text: its spans are at `deadlineScope`. */
  deadline: string | null;
  deadlineScope: string;
  steps: StepView[];
};

export type NoteView = { title: string; tone: "aviso" | "info"; spoiler: boolean; text: string | null };

export type MissableView = { item: ItemView; chapter: string };

/** A roadmap phase (the guide's GuideStep) as the page reads it: plain text, spans kept. */
export type PhaseText = { title: string; body: string };

export type WalkView = {
  notes: NoteView[];
  chapters: ChapterView[];
  missables: MissableView[];
  /** The roadmap phases, masked (their spans at phaseTitleScope / phaseBodyScope). */
  roadmap: PhaseText[];
};

/** What revealWalkSpoilers sends once the reader asks for spoilers. */
export type GatedItem = {
  name: string;
  nameEn: string | null;
  location: string | null;
  image: ItemImage | null;
  sources: ItemSource[];
  achievement: { name: string; description: string | null; iconUrl: string | null } | null;
};

export type WalkSpoilers = {
  /** By note index. */
  notes: Record<string, string>;
  /** By callout id (`chapter.step.block`). */
  callouts: Record<string, string>;
  /** By item ref. */
  items: Record<string, GatedItem>;
  /** Inline `||spoiler||` spans, by spanKey. */
  spans: Record<string, string>;
};

const calloutId = (c: number, s: number, b: number) => `${c}.${s}.${b}`;

/**
 * Span scopes: a read-first note, an item's location, a chapter's deadline, a roadmap phase's title
 * and body, a block's text (or list item / table cell).
 */
export const noteScope = (index: number) => `n${index}`;
export const locationScope = (ref: string) => `l:${ref}`;
export const deadlineScope = (chapter: number) => `d${chapter}`;
export const phaseTitleScope = (phase: number) => `rt${phase}`;
export const phaseBodyScope = (phase: number) => `rb${phase}`;
/** Key of the `index`-th span of the text at `scope`. */
export const spanKey = (scope: string, index: number | string) => `${scope}#${index}`;

/** The text with each `||spoiler||` span replaced by its index. */
function maskSpans(text: string): string {
  let k = 0;
  return text.replace(INLINE_SPOILER, () => `||${k++}||`);
}

/** The inline texts of a block mapped through `f`, with their scope suffix (list item, table cell). */
function mapBlockTexts(block: ContentBlock, f: (text: string, sub: string) => string): ContentBlock {
  switch (block.type) {
    case "paragraph":
    case "quote":
    case "callout":
      return { ...block, text: f(block.text, "") };
    case "list":
      return { ...block, items: block.items.map((text, i) => f(text, `.${i}`)) };
    case "table":
      return { ...block, rows: block.rows.map((row, r) => row.map((text, col) => f(text, `.${r}.${col}`))) };
    default:
      return block;
  }
}

/** Behind the gate: a spoiler item, or the item of a hidden Steam achievement. */
const isGated = (item: WalkItem, hiddenAchievement: boolean) => item.spoiler || hiddenAchievement;

function achView(a: WalkAchievementView, gated: boolean): AchView {
  return {
    id: a.id,
    name: gated ? null : a.name,
    description: gated ? null : a.description,
    iconUrl: gated ? null : a.iconUrl,
    globalPct: a.globalPct,
    hidden: a.hidden,
    xp: a.xp,
  };
}

function imageOf(item: WalkItem): ItemImage | null {
  return item.image ? { ...item.image, sourceUrl: item.image.sourceUrl ?? null } : null;
}

function itemView(item: WalkItem, achievements: WalkExtras["achievements"]): ItemView {
  const achievement = item.achievement ? achievements[item.achievement] : undefined;
  const gated = isGated(item, Boolean(achievement?.hidden));
  return {
    ref: itemRef(item.key, gated),
    kind: item.kind,
    gated,
    name: gated ? null : item.name,
    nameEn: gated ? null : (item.nameEn ?? null),
    collectibleType: item.collectibleType ?? null,
    index: item.index ?? null,
    total: item.total ?? null,
    location: gated || !item.location ? null : maskSpans(item.location),
    missable: item.missable,
    returnLater: item.returnLater,
    alsoOn: item.alsoOn,
    image: gated ? null : imageOf(item),
    sources: item.sources.map((s) => ({ name: s.name, url: gated ? null : s.url })),
    review: item.review,
    achievement: achievement ? achView(achievement, gated) : null,
  };
}

function blockView(block: ContentBlock, id: string): BlockView {
  if (block.type === "callout" && block.tone === "spoiler") return { type: "spoiler", id };
  return mapBlockTexts(block, maskSpans);
}

/** The masked page: what every component of the walkthrough renders from. */
export function walkView(
  walkthrough: Walkthrough,
  walk: WalkExtras,
  phases: (PhaseText & { key: string | null })[],
): WalkView {
  const phaseKeys = phases.map((p) => p.key);
  const chapters = walkthrough.chapters.map<ChapterView>((chapter, c) => ({
    key: chapter.key,
    phase: phaseKeys.indexOf(chapter.phaseKey) + 1,
    title: chapter.title,
    region: chapter.region ?? null,
    hours: chapter.hours,
    sceneImage: chapter.sceneImage ?? null,
    deadline: chapter.deadline ? maskSpans(chapter.deadline) : null,
    deadlineScope: deadlineScope(c),
    steps: chapter.steps.map((step, s) => ({
      number: `${c + 1}.${s + 1}`,
      scope: `${c}.${s}`,
      body: step.body.map((block, b) => blockView(block, calloutId(c, s, b))),
      items: step.items.map((item) => itemView(item, walk.achievements)),
    })),
  }));
  return {
    notes: walkthrough.readFirst.map((note) => ({
      title: note.title,
      tone: note.tone,
      spoiler: note.spoiler,
      text: note.spoiler ? null : maskSpans(note.text),
    })),
    chapters,
    roadmap: phases.map((p) => ({ title: maskSpans(p.title), body: maskSpans(p.body) })),
    missables: chapters.flatMap((chapter) =>
      chapter.steps.flatMap((step) =>
        step.items.filter((item) => item.missable).map((item) => ({ item, chapter: chapter.title })),
      ),
    ),
  };
}

/** Keys of the items behind the gate: the visitor's marks on them travel as refs (WalkUserIsland). */
export function walkGatedKeys(walkthrough: Walkthrough, walk: WalkExtras): string[] {
  return walkthrough.chapters.flatMap((chapter) =>
    chapter.steps.flatMap((step) =>
      step.items.flatMap((item) => {
        const achievement = item.achievement ? walk.achievements[item.achievement] : undefined;
        return isGated(item, Boolean(achievement?.hidden)) ? [item.key] : [];
      }),
    ),
  );
}

/** Steam text of a hidden achievement, as the reveal reads it from the database. */
export type HiddenText = { name: string; description: string | null; iconUrl: string | null };

/**
 * Everything `walkView` took out, by the same ids. `achievements` maps apiName to the achievement's
 * full Steam text (hidden ones included).
 */
export function walkSpoilers(
  walkthrough: Walkthrough,
  achievements: Record<string, HiddenText & { hidden: boolean }>,
  phases: PhaseText[] = [],
): WalkSpoilers {
  const out: WalkSpoilers = { notes: {}, callouts: {}, items: {}, spans: {} };
  const spans = (scope: string, text: string) => {
    [...text.matchAll(INLINE_SPOILER)].forEach((m, k) => (out.spans[spanKey(scope, k)] = m[1]));
    return text;
  };
  walkthrough.readFirst.forEach((note, i) => {
    if (note.spoiler) out.notes[String(i)] = note.text;
    else spans(noteScope(i), note.text);
  });
  phases.forEach((p, i) => {
    spans(phaseTitleScope(i), p.title);
    spans(phaseBodyScope(i), p.body);
  });
  walkthrough.chapters.forEach((chapter, c) => {
    if (chapter.deadline) spans(deadlineScope(c), chapter.deadline);
    chapter.steps.forEach((step, s) => {
      step.body.forEach((block, b) => {
        const id = calloutId(c, s, b);
        if (block.type === "callout" && block.tone === "spoiler") out.callouts[id] = block.text;
        else mapBlockTexts(block, (text, sub) => spans(`${id}${sub}`, text));
      });
      for (const item of step.items) {
        const achievement = item.achievement ? achievements[item.achievement] : undefined;
        if (!isGated(item, Boolean(achievement?.hidden))) {
          if (item.location) spans(locationScope(itemRef(item.key, false)), item.location);
          continue;
        }
        out.items[itemRef(item.key, true)] = {
          name: item.name,
          nameEn: item.nameEn ?? null,
          location: item.location ?? null,
          image: imageOf(item),
          sources: item.sources.map((x) => ({ name: x.name, url: x.url })),
          achievement: achievement
            ? { name: achievement.name, description: achievement.description, iconUrl: achievement.iconUrl }
            : null,
        };
      }
    });
  });
  return out;
}
