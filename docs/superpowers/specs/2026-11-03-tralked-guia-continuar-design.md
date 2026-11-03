# Guia: detonado só para logados, "continuar de onde parou" e voltar ao topo

Date: 2026-11-03. Owner: Lucas (Ludai Labs). Status: draft for Lucas's approval.

## Why

The robot's walkthrough pages are very long (Phantom Blade Zero: 20 chapters, ~770 items, ~2.7 MB of HTML). A player comes
back day after day, mid-game, and today has to scroll and hunt for the spot where they stopped. Lucas also wants the
complete walkthrough to be a reason to create an account on Tralked: without logging in, a visitor sees only the opening
of the guide.

The picture Lucas gave: someone played yesterday up to the middle of the Crimson Forest and opens the guide today. They
see the guide's cover and a button, **"Continuar de onde parou"**, that takes them down to where they got to yesterday.

## Goals

1. **Login wall on the guide body.** A visitor who is not signed in sees only the opening of the guide: everything
   before "Visão geral" (for a format-2 walkthrough: the magazine cover, the hero with its seals and the ficha). In place
   of the rest, a short invitation to sign in or create an account, which returns to the same guide afterwards
   (`returnTo`, as the page already does for ticking items).
2. **The walkthrough stays in Google.** Lucas chose this over hiding the body from search engines too. The body is
   marked as members-only content with Google's paywalled-content structured data (`isAccessibleForFree: false` plus
   `hasPart` / `cssSelector` on the gated section), and search engine crawlers get the full body. Boss names stay public
   for SEO, as Lucas asked earlier, and stay masked on the page as spoilers, as today.
3. **"Continuar de onde parou" for signed-in visitors.** It is a button on the cover. It scrolls to the visitor's resume
   point and briefly highlights that step. The resume point is computed from what the site already knows about the
   visitor: the items they ticked (GuideItemProgress) and the Steam achievements they have unlocked (synced). It is the
   **next item not yet done after the furthest item the visitor has reached** in the guide's order. The furthest item is
   the latest one that is ticked or whose achievement is unlocked. Lucas chose this ("seu palpite melhor") over "the
   last place they were reading".
4. **"Suas conquistas indicam que você está aqui".** At the resume point, a marker (a callout on that step) tells the
   visitor why the guide brought them there. The wording follows the evidence: unlocked achievements, ticked items, or
   both.
5. **The chapter journey line points at it.** The journey row/timeline that already shows chapters and progress marks
   the chapter of the resume point as "você está aqui". Clicking it goes to the resume point (not just the chapter start).
   **Passed chapters light up.** Lucas (print of the journey row): "cada ponto que o usuário tenha passado, fique
   verdinho claro aceso". Every chapter diamond the visitor has passed in their playthrough is drawn filled in light
   green and glowing ("aceso"). This applies to the journey row and to the timeline shown before each chapter. Today,
   only the chapters above the one being read get a thin outline (class `p` in `journey.tsx`), and that is based on
   scroll position, not on progress. My reading of "passado": every chapter before the resume point's chapter, plus
   any chapter whose items are all done. The resume point's own chapter carries the "você está aqui" marker. The
   chapter being read keeps its current highlight (green title).
6. **Quick back-to-top.** A small floating button appears once the visitor has scrolled well down the page and returns
   to the top (the cover, where "Continuar de onde parou" is) at once.

## Non-goals

- No reading-position memory in the browser. Lucas: anonymous visitors do not see the walkthrough at all ("por enquanto
  sem conta" → then "precisa logar sim"), so the resume point is account-based only.
- No change to the robot, the guide data or the API.
- No new progress storage: ticks and Steam unlocks already exist.
- The achievements-only page (games without a guide) stays public as it is.

## Anti-goals (would make this a failure even if it technically works)

- The walkthrough body reachable without logging in by a normal visitor (in the HTML, the RSC payload or a client
  fetch), except for verified search engine crawlers. A wall that "view source" defeats is not what Lucas asked for.
- The "continue" button sending a player backwards to chapter 1 because they skipped one collectible early on.
- Search engines treating the page as cloaking (missing or wrong paywall markup) and dropping it from results.
- The signed-in page becoming slow: the body is ~2.7 MB, and it must stay cached as data, not be recomputed per
  request.
- Spoilers leaking through the new marker or the invitation (hidden achievement names, boss names): the same masking
  rules as today (view.ts, R13).

## Constraints and existing pieces

- Next.js App Router with Cache Components (`use cache`, `cacheTag`), on Vercel. The guide page
  (`app/src/app/jogos/[slug]/guia/page.tsx`) is today one cached render that is public and the same for everyone. What
  is per visitor streams into Suspense islands (`WalkUserIsland`, `WalkReportIsland`), and `WalkUserSeedData` already
  brings `doneRefs` and `unlockedIds` to the client (`components/guide/walk/progress.tsx`).
- The gated body must therefore move out of the shared cached shell into a session-dependent part: rendered only for a
  signed-in visitor or a verified search crawler, while the guide data itself stays cached (`getGuideCached`).
- `app/src/proxy.ts` already blocks AI training crawlers. Search engine crawlers (Googlebot, Bingbot) must be verified
  (Vercel's verified-bot signal, or reverse DNS), never trusted by user-agent alone, since anyone can send that header.
- Item order for "furthest reached" is the walkthrough's order: chapters → steps → items, as rendered.
- Items of the walkthrough carry an `achievement` apiName; the page maps apiNames to database achievement ids
  (`walk.achievements`).
- Format-1 (classic) guides: see the builder's calls below.

## Decided by Lucas

- Login wall: without login, only the opening before "Visão geral"; the rest needs an account.
- The walkthrough stays indexable by Google ("modo que fica no Google e logados veem").
- The resume point comes from ticks and Steam unlocks; it is the next undone item after the furthest reached.
- The "continue" button sits on the cover and scrolls to the spot.
- Back-to-top button.
- Passed chapter diamonds lit up in light green, glowing.

## My calls (Lucas can overrule)

- **Skipped items.** When earlier items are still undone, the button still goes to the furthest point, and the marker
  adds a note like "3 itens ficaram para trás", with a link to the first of them. Lucas did not comment on this.
- **No progress yet.** For a signed-in visitor with no ticks and no unlocks, the button reads "Começar o detonado" and
  goes to chapter 1.
- **Format-1 (classic) guides get the same login wall.** The opening is the game head and the facts strip; everything
  from the overview on needs an account. They get no "continue" (their steps have their own ticks), only back-to-top.
- **The wall's text and look** follow the Tralked visual (graphite + green) and the existing sign-in invitation used for
  ticking. Copy in pt-BR, short, without hype.
- **The verified-crawler check** is left to the builder (Vercel's verified-bot header or reverse DNS), with a test. When
  in doubt, a request is treated as a normal anonymous visitor.

### Settled after the builder check (my calls)

- **Where the wall starts, format 2.** These stay public:
  - the magazine cover;
  - the hero and its seals;
  - the ficha;
  - the soundtrack player;
  - the backdrop;
  - the game head.

  Everything else is gated, following Lucas's "só a introdução, antes de visão geral":
  - "Visão geral";
  - "Leia antes";
  - the roadmap (`PhaseRoadmap`);
  - the sidebar;
  - the journey row and the chapter timelines;
  - the chapters;
  - the "Só na Steam" block;
  - comments and reactions.

  `SpoilerProvider`, `WalkProgressProvider`, `BackdropFader` and `SoundtrackPlayer` stay at page level.
- **Format 1 (classic) mirrors it.** The game head and facts strip are public. From `Overview` on, everything is gated:
  - roadmap, achievements, collectibles and tips;
  - revisions and sources;
  - sidebar, comments and reactions.

  Inside the wall, the existing login-dependent islands keep their own behaviour.
- **SEO text that stays public.** The existing HowTo JSON-LD is unchanged: its first overview paragraph and the roadmap
  stage titles and summaries. That is the coarse plan Google shows, not the walkthrough itself. The page metadata,
  `/jogos/[slug]`, the sitemap and the home cards are unchanged too. The paywall markup (`isAccessibleForFree: false`,
  `hasPart` → the gated section's selector) is added next to it.
- **Rendering.** The shell stays static and cached: the opening, plus a neutral skeleton as the Suspense fallback of the
  gated section. The fallback is never the invitation, so a member does not see it flash. One session-dependent island
  then renders either the cached body (member or verified crawler) or the invitation (anyone else). The body's data stays
  in `getGuideCached`. Personalized output is never shared through the CDN, and the route must not get a public
  cache header that would serve one visitor's variant to another.
- **Crawlers.** Only Googlebot and Bingbot get the body, verified by Vercel's verified-bot signal if this Pro project
  has one, or by reverse plus forward DNS, cached per IP. Anything unverified is an anonymous visitor. AI crawlers stay
  blocked in `proxy.ts`.
- **Cover button by state.**
  - Anonymous: "Entrar para ler o detonado", linking to sign-in with `returnTo`.
  - Signed in, while the seed streams: a skeleton.
  - Then "Continuar de onde parou", or "Começar o detonado" when there is no progress.
  - When nothing is left: "Guia concluído", which goes to the last chapter.
- **"Furthest reached".** It is the maximum position, in walkthrough order, over ticked items and over items whose
  achievement is unlocked. These items are left out of that maximum:
  - items of the cleanup chapter;
  - loose achievements without a fixed place;
  - Steam-only achievements, which have no item.

  When an apiName appears on several items, its first item counts. The resume point is the next undone item overall
  after that position, across steps and chapters. The journey marker and the scroll target live in the gated island and
  are resolved on the client from the refs.

## Left to the builder

- How the gated body streams: a session-dependent island that renders the cached body component. It must keep the
  body's data cached, keep spoiler masking, and keep the existing user islands working.
- The exact paywall JSON-LD alongside the existing `howToJsonLd`, and the CSS selector of the gated section.
- How the resume point is computed: on the client from the existing seed, or on the server with the seed. Either way,
  it must be unit-tested on the cases above (furthest reached, skipped items, nothing yet, guide finished).
- The scroll and highlight behaviour (respecting `prefers-reduced-motion`), and the back-to-top threshold.
- Tests: an anonymous visitor's HTML and RSC payload contain no walkthrough body; a verified crawler gets it with the
  paywall markup; a signed-in visitor gets the body plus the button; resume-point cases; the journey marker.
