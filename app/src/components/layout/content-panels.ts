/*
 * Content panels over the parallax backdrop (Lucas, 11-06). Blocks of the page that have no box of
 * their own (lists, sections, forms, section titles) get the preview's panel: graphite at 80%, a
 * margin around the content and a hairline edge (parallax-backdrop.css, [data-tk-panel]). The margin
 * is drawn outside the block, so two blocks closer than two margins would stack their frames: those
 * share one panel instead, on their closest common ancestor. Recomputed when the page changes.
 */

/** Blocks that can become a panel: the outermost ones without a background of their own. */
const BLOCKS = "section, aside, article, header, nav, form, ul, ol, table, h1, h2, h3, h4, p, [data-section-head]";
const OWN_BG = '[class^="bg-"], [class*=" bg-"], [style*="background"]';
export const PANEL_CANDIDATES = `#principal :is(${BLOCKS}):not(${OWN_BG}):not(#principal :is(${BLOCKS}, ${OWN_BG}) *)`;

/** Two frames of 7 px each, plus a little air. */
export const MERGE_GAP = 20;

type Box = { left: number; right: number; top: number; bottom: number };

function gapBetween(a: Box, b: Box): number {
  const dx = Math.max(b.left - a.right, a.left - b.right, 0);
  const dy = Math.max(b.top - a.bottom, a.top - b.bottom, 0);
  return Math.max(dx, dy);
}

function commonAncestor(a: Element, b: Element): Element | null {
  for (let x: Element | null = a; x; x = x.parentElement) if (x.contains(b)) return x;
  return null;
}

/**
 * The elements to paint: the candidates, with every pair closer than `minGap` replaced by their
 * closest common ancestor inside `root`, the root itself included (repeated until no two panels
 * touch). An ancestor that cannot be painted (it has a background of its own) leaves the pair as it was.
 */
export function groupPanels(
  root: Element,
  candidates: Element[],
  boxOf: (el: Element) => Box,
  canPaint: (el: Element) => boolean,
  minGap = MERGE_GAP,
): Element[] {
  let panels = [...candidates];
  const blocked = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    const boxes = panels.map(boxOf);
    search: for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        if (gapBetween(boxes[i], boxes[j]) >= minGap) continue;
        const key = `${i}:${j}:${panels.length}`;
        if (blocked.has(key)) continue;
        const lca = commonAncestor(panels[i], panels[j]);
        if (!lca || !root.contains(lca) || !canPaint(lca)) {
          blocked.add(key);
          continue;
        }
        panels = [...panels.filter((p) => !lca.contains(p)), lca];
        blocked.clear();
        changed = true;
        break search;
      }
    }
  }
  return panels;
}

const transparent = (color: string) => color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color);

/** An element can carry a panel when it has no background of its own. */
function paintable(el: Element): boolean {
  const s = getComputedStyle(el);
  return s.backgroundImage === "none" && (transparent(s.backgroundColor) || el.hasAttribute("data-tk-panel"));
}

/*
 * React owns these elements: an attribute added before React hydrates one (a streamed section still
 * waiting for its turn) breaks that hydration. React tags each element it owns with a "__reactFiber$"
 * property, so the marks wait for it; until then the CSS fallback keeps painting the blocks.
 */
const hydrated = (el: Element) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"));

/**
 * Marks the panels of the current page (data-tk-panel). Returns "pending" (and changes nothing)
 * while one of them is not hydrated yet: call again a moment later.
 */
export function markContentPanels(doc: Document = document): "done" | "pending" {
  const root = doc.getElementById("principal");
  if (!root) return "done";
  let candidates: Element[];
  try {
    candidates = [...doc.querySelectorAll(PANEL_CANDIDATES)];
  } catch {
    return "done";
  }
  // A walkthrough guide brings its own animated backdrop and frosted cards: no panels over its art.
  const ownBackdrop = doc.querySelector(".wk-bgfx") !== null;
  candidates = ownBackdrop
    ? []
    : candidates.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      });
  const panels = new Set(groupPanels(root, candidates, (el) => el.getBoundingClientRect(), paintable));
  if ([...panels].some((el) => !el.hasAttribute("data-tk-panel") && !hydrated(el))) return "pending";
  for (const el of doc.querySelectorAll("[data-tk-panel]")) if (!panels.has(el)) el.removeAttribute("data-tk-panel");
  for (const el of panels) if (!el.hasAttribute("data-tk-panel")) el.setAttribute("data-tk-panel", "");
  doc.documentElement.setAttribute("data-tk-panels", "");
  return "done";
}
