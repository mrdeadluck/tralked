export const SOURCE_ROLES = ["roteiro_psn", "roteiro_steam", "coletaveis", "confirmacao"] as const;
export type SourceRole = (typeof SOURCE_ROLES)[number];

export type SourceRef = { name: string; url: string; role: SourceRole; language?: string };

/** What a page fetch returns (Task 5's politeFetch is adapted to this shape by the caller). */
export type FetchPage = (url: string) => Promise<{
  status: "ok" | "blocked" | "challenge" | "error";
  text?: string;
  html?: string;
  finalUrl: string;
  reason?: string;
  /** The text stopped at `PAGE_TEXT_MAX`: only the start of the page was read. */
  truncated?: boolean;
}>;
