import type { ReactNode } from "react";
import { inlineMarkup } from "@/lib/content/render";
import { SpoilerSpan } from "./spoilers";
import { spanKey } from "./view";

/*
 * Inline text of a walkthrough as the page shows it (server or client): **bold**, *italic*, links,
 * and a gate for each `||spoiler||` span. The text comes masked from view.ts (spans reduced to
 * their index), so `scope` + index name the span whose real text arrives on reveal.
 */
export function walkInline(text: string, scope: string): ReactNode[] {
  return inlineMarkup(text, { spoiler: (index) => <SpoilerSpan id={spanKey(scope, index)} /> });
}

/**
 * Plain text of the page (a roadmap phase, a chapter's deadline) with a gate for each masked
 * `||spoiler||` span and no other markup.
 */
export function walkPlain(text: string, scope: string): ReactNode[] {
  // split() with a capture group alternates text and span indexes: text, index, text, …
  return text.split(/\|\|(\d+)\|\|/).map((part, i) =>
    i % 2 === 0 ? part : <SpoilerSpan key={i} id={spanKey(scope, part)} />,
  );
}
