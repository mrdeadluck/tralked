import { RELEASE_PLATFORMS, type ReleasePlatform } from "./platforms";

/** Client-safe shapes and constants of the releases UI (no database imports). */

export type ReleaseTab = "ultimos" | "proximos";
export const RELEASE_TABS: { id: ReleaseTab; label: string; hint: string }[] = [
  { id: "ultimos", label: "Últimos", hint: "últimos 30 dias" },
  { id: "proximos", label: "Próximos", hint: "próximos 90 dias" },
];

export type ReleaseFilter = "TODAS" | ReleasePlatform;
/** Platform filters, PC first ("principalmente do PC"); PC is the default. */
export const RELEASE_FILTERS: ReleaseFilter[] = [...RELEASE_PLATFORMS, "TODAS"];

/** A release as the card and /lancamentos show it (plain data: crosses to client components). */
export type ReleaseView = {
  gameId: string;
  slug: string;
  name: string;
  /** Portrait cover when the catalog has one. */
  coverUrl: string | null;
  /** Wide store capsule otherwise (Steam). */
  capsuleUrl: string | null;
  /** The store's 616×353 main capsule (nearly 16:9, logo whole): what a wide thumbnail shows first. */
  wideUrl?: string | null;
  platforms: ReleasePlatform[];
  /** "2026-11-14", or null when not set to a day. */
  day: string | null;
  /** "14 de nov.", the source's own text ("4º trimestre de 2026") or "a definir". */
  dateText: string;
  /** "hoje", "amanhã", "há 3 dias", "em 12 dias"; null without a day. */
  relative: string | null;
  score: number;
  /** Size of the release on one scale for every source (lib/releases/heat.ts): lists lead with it. */
  heat: number;
  /** Name-only catalog entry: its page says details are on the way. */
  stub: boolean;
};

/** The home card: per tab and filter, the most popular releases (PC is the default filter). */
export type ReleasesCardData = {
  tabs: Record<ReleaseTab, Record<ReleaseFilter, ReleaseView[]>>;
  /** IGDB is off (production without credentials): consoles have no releases yet. */
  consolesOff: boolean;
};
