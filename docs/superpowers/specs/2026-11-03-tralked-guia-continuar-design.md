# Guia: "continuar de onde parou", capítulos acesos e voltar ao topo

Date: 2026-11-03. Owner: Lucas (Ludai Labs). Status: draft for Lucas's approval.

## Why

The robot's walkthrough pages are very long (Phantom Blade Zero: 20 chapters, ~770 items, ~2.7 MB of HTML). A player comes
back day after day, mid-game, and today has to scroll and hunt for the spot where they stopped. Lucas's picture: someone
played yesterday up to the middle of the Crimson Forest and opens the guide today. They see the guide's cover and a
button, **"Continuar de onde parou"**, that takes them down to where they got to yesterday.

Being signed in is what makes this possible, so it is also a reason to have a Tralked account. Lucas decided that the
guide itself stays open to everyone: "deixe liberado pra geral. Mas apenas quem tá logado consegue voltar de onde
parou. Quem não tá precisa fazer manual."

## Goals

1. **"Continuar de onde parou" for signed-in visitors.** It is a button on the cover. It scrolls to the visitor's resume
   point and briefly highlights that step. The resume point is computed from what the site already knows about the
   visitor: the items they ticked (GuideItemProgress) and the Steam achievements they unlocked (synced). It is the
   **next item not yet done after the furthest item the visitor has reached** in the guide's order. The furthest item is
   the latest one that is ticked or whose achievement is unlocked. Lucas chose this ("seu palpite melhor") over "the
   last place they were reading".
2. **"Suas conquistas indicam que você está aqui".** At the resume point, a marker (a callout on that step) tells the
   visitor why the guide brought them there. The wording follows the evidence: unlocked achievements, ticked items, or
   both.
3. **Chapters light up.** Lucas (print of the journey row): "cada ponto que o usuário tenha passado, fique verdinho claro
   aceso". For a signed-in visitor, every chapter diamond they have passed is drawn filled in light green and glowing.
   This applies to the journey row and to the timeline shown before each chapter. "Passed" means every chapter before
   the resume point's chapter, plus any chapter whose items are all done. The resume point's chapter carries a "você
   está aqui" marker; clicking it goes to the resume point, not just the chapter start. The chapter being read keeps its
   current highlight (green title). Today, only the chapters above the one being read get a thin outline (class `p` in
   `journey.tsx`), and that follows the scroll, not progress. For anonymous visitors the row stays as it is.
4. **Quick back-to-top, for everyone.** A small floating button appears once the visitor has scrolled well down the
   page and returns to the top (the cover) at once.

5. **"Qual versão você joga?": Steam or PlayStation, for everyone.** Lucas: the PlayStation player should not see
   the Steam-only achievements, and should see the roadmap for their own trophies. The page should say the guide works
   for both. "Na PSN o usuário não recebe troféus que não fazem parte do roadmap dele."
   - The robot writes one guide; it is not written twice. The Steam guide covers all 66 achievements. Each item knows
     whether its achievement is also on the PlayStation list (`alsoOn: ["psn"]`, correct since 7fa4659), and the report
     carries the PSN list's size (`coverage.psn`).
   - A switch near the top, "Steam | PlayStation", filters the page. PlayStation hides:
     - items whose achievement is not on the PlayStation list;
     - items that only count toward such achievements (`countsFor` entirely Steam-only);
     - steps and chapters left empty by that.

     Everything else stays, including the walkthrough steps that are not achievements. The ficha numbers, chapter
     counts, journey row, missable counts and the resume point follow the chosen version.
   - The seal says the guide covers both, for example "STEAM E PLAYSTATION · 66 conquistas / 36 troféus", instead of
     "APENAS STEAM".
   - Only for a guide that has both lists: a Steam-only guide with no PSN list, or a guide written from the PSN list
     (scope psn), shows no switch.

## Non-goals

- No login wall: the whole guide stays public and indexable, as today.
- Anonymous visitors get no resume point and no reading-position memory: they find their place by hand.
- No change to the robot, the guide data, the API or the database: ticks and Steam unlocks already exist.

## Anti-goals

- The "continue" button sending a player backwards to chapter 1 because they skipped one collectible early on.
- The public, cached guide page losing its caching: the per-visitor part stays in the existing user island.
- Spoilers leaking through the new marker (hidden achievement names, boss names): the same masking rules as today
  (view.ts, R13).

## Constraints and existing pieces

- Next.js App Router with Cache Components on Vercel. The guide page (`app/src/app/jogos/[slug]/guia/page.tsx`) is one
  cached render, the same for everyone. What is per visitor streams into Suspense islands: `WalkUserIsland` seeds
  `WalkProgressProvider` (`components/guide/walk/progress.tsx`) with `doneRefs` and `unlockedIds` on the client.
- The journey row and the chapter timelines are `JourneyRow` in `components/guide/walk/journey.tsx`, used by
  `WalkJourney` and `ChapterTimeline`.
- Items carry an `achievement` apiName; the page maps apiNames to database achievement ids (`walk.achievements`).
- Item order is the walkthrough's order: chapters → steps → items, as rendered.

## Decided by Lucas

- The guide stays open to everyone; only signed-in visitors get "continuar de onde parou".
- The resume point comes from ticks and Steam unlocks: the next undone item after the furthest one reached.
- The button sits on the cover and scrolls down to the spot.
- Passed chapter diamonds light up in light green, glowing.
- A back-to-top button.
- A Steam / PlayStation switch on one guide (not two written guides). PlayStation hides what does not exist there. The
  page says the guide works for both.

## My calls (Lucas can overrule)

- **Anonymous cover.** Where a member sees the button, an anonymous visitor sees a small link: "Entre para continuar
  de onde parou". It goes to sign-in and returns to the guide. It is an invitation, not a wall.
- **Button by state.**
  - Signed in, while the seed streams: a skeleton.
  - Then "Continuar de onde parou", or "Começar o detonado" when there is no progress.
  - When nothing is left: "Guia concluído", which goes to the last chapter.
- **Skipped items.** When earlier items are still undone, the button still goes to the furthest point, and the marker
  adds "N itens ficaram para trás", with a link to the first of them.
- **"Furthest reached".** It is the maximum position over ticked items and over items whose achievement is unlocked.
  These are left out of that maximum, so that one achievement done out of order does not throw the player far ahead:
  - items of the cleanup chapter;
  - loose achievements without a fixed place;
  - Steam-only achievements, which have no item.

  When an apiName appears on several items, its first item counts. The resume point is the next undone item overall
  after that position, across steps and chapters. It is computed on the client from the seed.
- **Which version shows first.** Steam is the default. The visitor's choice is remembered in their browser and also
  goes in the URL (`?versao=playstation`), so a shared link opens the same version. The cached page stays the same for
  everyone, and the filter runs on the client.
- **Robot prose that cites Steam numbers.** For example, a cover line that says "66 conquistas" stays as written in
  both versions. The numbers the code owns (ficha, seal, counts) switch. The builder lists those prose spots for PBZ
  in the report, so Lucas can decide whether they bother him.
- **Format-1 (classic) guides** get only the back-to-top button. Their steps already have their own ticks.

## Left to the builder

- The scroll and highlight behaviour (respecting `prefers-reduced-motion`), and the back-to-top threshold.
- The look of the lit diamonds, the marker and the buttons, in the Tralked visual (graphite + green).
- Tests:
  - the resume-point cases: furthest reached, skipped items, nothing yet, guide finished, an out-of-order
    achievement in the cleanup chapter;
  - the button in each state;
  - lit chapters;
  - the "você está aqui" marker;
  - anonymous visitors see the invitation and no lit chapters.
