# Plan: guide voice v2 + "continuar de onde parou" / lit chapters / back-to-top / Steam-PlayStation switch

Spec: `docs/superpowers/specs/2026-11-03-tralked-guia-continuar-design.md` (site UX), plus Lucas's direction on the
guide text (2026-11-03, below; it is binding).

## Lucas on the guide text (binding)

Print of the PBZ guide on mobile, Blood-Stopper Vine step. Lucas: "queria uma linguagem mais humana, amiga, e que
falasse com clareza"; "quando fala 'não tive certeza da fonte, melhor confirmar no jogo', isso é inadmissível. O guia é
para ajudar o usuário, não para ele descobrir sozinho"; "textos mais claros… precisa ser mais explícito e explicar
melhor". He approved this rewrite of the same item as the target ("ficou muito melhor, faça todas essas melhorias"):

> **Blood-Stopper Vine** · ⚠ PERDÍVEL
> Logo depois de pegar a Focus Pill no baú, volte em direção à ponte de pedra e desça para o riacho que passa embaixo
> dela. A erva está na água, no canto oeste da ponte.
> **Para que serve:** é uma das 3 ervas que a Yu'er pede na missão *Apprentice Healer* (as outras duas, Congealeaf e
> Blemish Goldweed, aparecem nos próximos passos). Quando tiver as 3, entregue para ela no sino Outpost.
> **Não deixe para depois:** se você derrotar o chefe Jing Ye, The Outlaw, na Crimson Forest com essa missão ainda
> aberta, ela falha e você perde a conquista *The Healer's Legacy* nesta jogada.

What it fixed, versus the live text:
- one missable warning instead of three: the robot's "Perdível: pegue … agora" callout, the writer's own aviso and the
  page's "⚠ Perdível no próximo passo";
- the path told from where the player just was, instead of "nos arredores de";
- what the item is for and what comes next;
- the risk as cause and consequence;
- no "confira no jogo" or "só uma fonte cita este ponto".

## Global constraints

The ledger's global constraints (`.superpowers/sdd/2026-11-03-tralked-robo-guias/global-constraints.md`) apply, with
these overrides by Lucas:
- the prod robot key has `publish` and stays as is for now;
- deploy / push to main is authorized.

Names stay as the current manual says: English when there is no official translation.

## Task 1: Guide voice v2 (robot)

Worktree from feat/robo-guias. Files:
- `ROBO NOTICIAS/prompts/guia-estilo.md`;
- `ROBO NOTICIAS/src/guias/writer.ts`;
- `ROBO NOTICIAS/src/guias/checker.ts`;
- `ROBO NOTICIAS/src/guias/copy-check.ts`;
- `ROBO NOTICIAS/src/guias/writing-cache.ts`;
- tests under `ROBO NOTICIAS/test/guias/`.

Requirements:
1. **Rewrite the style manual** (`guia-estilo.md`) toward the approved example. Keep every rule that is still valid:
   - Tralked vocabulary;
   - names;
   - never invent;
   - the 8-word copy rule;
   - spoilers;
   - cover, ficha and format.

   Change these:
   - **Voice:** a friend who has finished the game and walks you through it. Every item's `local` says the way **from
     the previous point of the walkthrough** (the previous item or bell) to the item, concretely. Use landmarks and
     directions the dossier gives ("desça para o riacho embaixo da ponte", "no baú à esquerda da porta"). Never use a
     vague area ("nos arredores de", "na região de") when the dossier has the concrete place.
   - **Purpose and next step:** when the dossier says what an item is for (a tale/mission component, a key that opens
     something, a part of a collection), say it in plain words: who asks for it and what to do with it.
   - **Risk:** a missable is explained as cause and consequence ("se você derrotar X com a missão aberta, ela falha e
     você perde a conquista Y nesta jogada"), in the item or step text, once.
   - **Uncertainty is never handed to the reader.** These are forbidden in any text:
     - "confira no jogo";
     - "confirme no jogo";
     - "as fontes divergem";
     - "só uma fonte";
     - "uma fonte diz";
     - "não há certeza";
     - "segundo as fontes";
     - "em revisão".

     When sources differ, write the safest correct instruction (e.g. the earliest deadline, the larger count to collect)
     without mentioning the doubt. When a fact has a single source, write it plainly. The `review` flag is for the
     editor, not the reader. Section 5's "diga o que é certo e avise do ponto em dúvida" and the single-source paragraph
     are replaced accordingly.
   - **One warning per missable.** The page itself shows a warning box before a step with missables (the item names
     and the chapter deadline) and a "PERDÍVEL · PEGUE AGORA" tag on the item. So the writer writes no `aviso` block
     that only repeats "pegue X agora". It explains the consequence in the item's `local` (or one `aviso` when the risk
     covers several items of the step).
   - **Clarity:**
     - short sentences, in order of play;
     - one action per sentence;
     - bold for the thing to find;
     - say how many there are when the dossier gives it ("é uma das 3 ervas").
   - `local` may be up to the site schema's limit for an item location (check `walkthrough-schema.ts`; use the real
     limit, and raise the manual's "até 400 caracteres" to it if it is higher).
2. **Writer code (`writer.ts`).**
   - Remove the code-added per-step callout `Perdível: pegue … agora, antes de seguir.` (around the
     `unwarned` / `warnedName` block in assemble, with its `codeWarnings` entry). The page's warning box covers it.
   - Keep the chapter anchor warning (`anchorText`, achievements whose missable window opens in this chapter) and the
     R39 count callouts.
   - Update the job prompt line about "Avisos de perdível que o sistema põe" to say what the page shows.
   - Keep `NAMES_RULE`.
3. **Deterministic ban list.** Add a check (the place where the copy check produces writer problems, `copy-check.ts`
   `deterministicProblems` or next to it) that turns any of the forbidden phrases of 1.d, case- and accent-insensitive,
   in any reader-facing text of the payload into a writer problem for that part's scope, so that part gets rewritten.
   Tests: each phrase is caught; a normal sentence is not.
4. **Checker (`checker.ts`).** Its prompt must flag, as defects:
   - text that hands uncertainty to the reader;
   - a vague location when the dossier has a concrete one;
   - a missable whose consequence is not explained;
   - repeated warnings.

   It must stop asking the writer to disclose single-source doubt, if it does today (read the prompt).
5. **Bump `WRITER_CACHE_VERSION`** (writing-cache.ts): the voice changed, so the cached writing and drafts of older
   versions must not be reused as approved. Carried drafts are then re-checked by design (Task 21), and a full rewrite
   is intended.
6. Run the robot suite and typecheck. Do NOT run `pnpm guia` (no AI calls).

Commit: `feat(robo-guias): guide voice v2 — friendly, explicit, no doubt handed to the reader, one missable warning`

## Task 2: Continue where you left off, lit chapters, sync, back-to-top (site)

Worktree from feat/robo-guias. Spec goals 1–4 and 6 and "My calls". Files mostly in `app/src/components/guide/walk/`:
- `progress.tsx`;
- `journey.tsx`;
- `WalkJourney.tsx`;
- `ChapterTimeline.tsx`;
- `GuideHero.tsx` / `MagazineCover.tsx` (the cover button);
- `WalkStepView.tsx` / `WalkChapters.tsx` (marker, missed panel);
- `WalkItemRow.tsx`;
- CSS in `walk.css` / `walk-chapters.css`;
- a new pure module, e.g. `resume.ts` + test.

Requirements:
1. **Pure resume module** (`resume.ts`), unit-tested. Input:
   - the ordered item list (refs in walkthrough order, with chapter key, step key, missable flag, deadline chapter
     index if any, cleanup/loose flags, achievement id);
   - `isDone(ref)`;
   - `isUnlocked(achievementId)`.

   Output:
   - `furthest`;
   - `resume` (ref, chapter, step), or `null` when everything is done;
   - `behind` (undone items before the resume point, not counting the cleanup chapter);
   - `possiblyMissed` (missable, not done, deadline behind the resume point);
   - `passedChapters` (indexes);
   - `evidence` ("conquistas" | "itens" | "ambos" | "nenhum").

   Rules from the spec:
   - "Furthest" is the maximum position over done items, where an item counts as done if it is ticked or its achievement
     is unlocked.
   - Items of the cleanup chapter, loose achievements and Steam-only ones are excluded from the maximum.
   - An apiName on several items counts its first item.
   - "Resume" is the next undone item after "furthest", overall.
   - "Passed chapters" are those before the resume chapter, plus any chapter whose items are all done.

   Cases:
   - nothing done;
   - linear progress;
   - skipped items (behind = N);
   - an out-of-order achievement in the cleanup chapter does not move "furthest";
   - guide finished;
   - possiblyMissed;
   - done by unlock only.
2. **An item whose achievement is unlocked shows as done everywhere**: rows, chapter counts, journey counts, slim bar.
   Today some counts use only ticks (`doneCount` over `isDone`). Unify through one predicate in `progress.tsx`.
3. **Cover button** (`GuideHero` / cover area), by state:
   - Anonymous: a small link, "Entre para continuar de onde parou", which goes to sign-in with `returnTo`, using the
     page's existing sign-in pattern.
   - Signed in, while the seed streams: a skeleton.
   - Then "Continuar de onde parou", or "Começar o detonado" with no progress.
   - "Guia concluído" when `resume === null`, which goes to the last chapter.

   Clicking scrolls to the resume item's row and briefly highlights it. Smooth scroll, instant under
   `prefers-reduced-motion`. A gated (spoiler) item is scrolled to without revealing its name.
4. **"Você está aqui" marker** on the resume step, a callout:
   - "De acordo com suas conquistas, você está aqui na história" (evidence conquistas);
   - "Pelos itens que você marcou, você está aqui" (itens);
   - a combined phrase (ambos).

   When `behind > 0`, it adds "N itens ficaram para trás", with a link to the first. Spoiler masking as everywhere.
5. **"Talvez você tenha perdido" panel**, at the marker, when `possiblyMissed` is not empty. It lists each item with a
   link to its row. Gated names are masked like the existing `SpoilerItemName`. Copy: "talvez", plus the note that it
   may need another playthrough or chapter select.
6. **Lit chapters.** In `JourneyRow`, for a signed-in visitor:
   - every chapter in `passedChapters` gets a new class, drawn filled in light green (lime `--acc` fill) with a soft
     glow;
   - the resume chapter gets "você está aqui" styling and its link targets the resume item (`#item-…` anchor, or
     whatever the row's id is);
   - this applies to `WalkJourney` and to every `ChapterTimeline`;
   - anonymous: unchanged.

   Keep the existing reading-position highlight. No new colors beyond the global constraints.
7. **After a sync** (the existing check action in `progress.tsx`, `check()`), when new unlocks arrive:
   - recompute;
   - show the marker message;
   - scroll to the resume point automatically.

   On a plain page load with a seed, do not auto-scroll: only the button.
8. **Back-to-top**: a small floating button for everyone, shown after the visitor scrolled past roughly 1.5 viewport
   heights. It goes to the top, smooth or instant under reduced motion. It has an accessible name, sits over the content
   at mobile width without covering the slim bar, and also appears on format-1 guide pages.
9. **Public item rows lose "· em revisão" and the "N fonte(s)" count dot.** The source links stay, credited as today;
   the review state is for staff: show it only when the page is a staff preview, or drop it if there is no staff
   signal on the public page. Test that the public row has no "em revisão".
10. **Tests (vitest + Testing Library, like `timeline.test.tsx` / `chapters.test.tsx`):**
    - `resume.ts` cases;
    - button states;
    - marker texts;
    - missed panel with a masked name;
    - lit chapter classes in the journey row and timeline;
    - auto-scroll only after check (mock `scrollIntoView`);
    - back-to-top visibility;
    - no "em revisão" on public rows.

    Then the full site suite (the pre-existing steam-reviews failure is known), `tsc` and lint.

Commit: `feat(guia): continuar de onde parou, capítulos acesos, sincronização que aponta perdíveis, voltar ao topo`

## Task 3: Steam / PlayStation switch (site)

Branch from Task 2's result (same files). Spec goal 5 and "My calls".

Requirements:
1. **Only for a format-2 guide with `compat === "steam_only"` and `walk.compatCounts` present** (the PSN list size
   known). Not for scope psn, and not without a PSN list.
2. **The switch** ("Steam | PlayStation", a segmented control in the hero next to the seal) filters the page on the
   client. The cached HTML stays the same for everyone. Under PlayStation:
   - hidden items:
     - items whose `achievement` exists and whose `alsoOn` lacks "psn";
     - items without `achievement` whose `countsFor` is non-empty and all Steam-only (not on PSN; derive the set from
       items whose `achievement` lacks psn, or pass the Steam-only apiName set from the server in `walk`, whichever is
       exact; add it to `GuideDetail.walk` if needed);
   - hidden steps and chapters: those left with no items, and no text of their own beyond warnings about hidden items
     (keep story steps that have paragraph text);
   - counts that switch:
     - ficha totals;
     - chapter counts;
     - journey;
     - missable counts;
     - slim bar;
     - resume (Task 2's module gets the filtered list);
   - the cover keeps its robot-written prose.
3. **The seal becomes** "STEAM E PLAYSTATION", with the note "66 conquistas na Steam · 36 troféus no PlayStation"
   (numbers from `compatCounts`) instead of "APENAS STEAM". The "Os passos marcam quais valem nas duas" hint stays.
4. **Choice persistence.**
   - The choice is remembered in localStorage, wrapped in try/catch, and reflected in the URL `?versao=playstation`,
     using `history.replaceState` with no navigation.
   - The URL wins over storage.
   - The default is Steam.
   - SSR renders Steam, and the client applies the choice after hydration without a layout jump, using a class on the
     root that hides with CSS (`[data-versao=playstation] .wk-steam-only { display:none }`). Hidden items and empty
     steps get a marker class at render time, from data already in the view.
5. **Tests:**
   - switch visibility rules;
   - items hidden and counts switched under PlayStation;
   - URL and storage precedence;
   - the seal text;
   - a scope-psn guide shows no switch.

   Then the full suite, tsc and lint.

Commit: `feat(guia): versão Steam ou PlayStation no mesmo guia`

## Task 4 (controller): rewrite PBZ with voice v2, publish, verify

1. Merge Tasks 1–3 into feat/robo-guias, deploy (push main), check the live page renders.
2. Raise `GUIDE_BUDGET_USD` in the robot `.env` so a full rewrite fits (the request already spent US$ 67).
3. Probe one chapter (`pnpm guia -- --appid 4115450 --sonda --capitulos 1`). Read the texts against Lucas's example.
   Fix the manual and re-probe if the voice is off.
4. Full run: `pnpm guia -- --appid 4115450 --atualizar --aceitar-pendencias 2`. The key has publish, so it goes live.
5. Validate the live page:
   - no forbidden phrases;
   - one warning per missable;
   - seal and switch;
   - images still credited;
   - counts.

   Report the spend.
