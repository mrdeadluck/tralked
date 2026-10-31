# GAMELOG Plano 1 — decisões e pendências

Registro gerado ao fim da execução do Plano 1 (branch feat/plano-1-fundacao). Decisões tomadas pelo controlador durante a execução e itens adiados para os próximos planos.

## Decisões (rulings)
- Ruling: `src/lib/engine/types.ts` (SkillId, SKILLS, RarityTier, SkillState) is created in Task 1 instead of Task 3 — lets Tasks 2, 3+4 and 6 run in parallel without conflicts — cost if wrong: trivial move.
- Ruling: User asked explicitly for parallel agents; run independent tasks in parallel waves, each implementer in its own git worktree, merged by controller before review (overrides skill's "no parallel implementers") — waves: [1] → [2 ‖ 3+4 ‖ 6] → [5] → [7] → [8] → [9 ‖ 10 ‖ 11 ‖ 12] → [13] — cost if wrong: merge conflicts in package.json/lockfile, resolved by controller.
- Ruling: Tasks 3 and 4 batched into one implementer (same module, pure functions) — cost: larger single review.
- Ruling: implementers/reviewers on sonnet; final review on opus.
- Ruling: Wave A starts before Task 1 review closes — speed requested by user — cost: Task 1 fixes must be merged into wave branches (expected small, env.ts only).
- Ruling: invented mission templates accepted — daily 'Desbloqueie 5 conquistas' 8000 XP, weekly 'Desbloqueie 10 conquistas raras' 50000 XP — needed 3 daily/2 weekly, preview had 3 — cost: copy tweak. Shielded days keep streak but don't add to count.
- Ruling: start Task 5 before engine review closes — cost: engine fixes may require seed tweak.
- Ruling: vocation for 0 trained skills = "Recruta"; trained = level>1 or points>0 — spec only defined fallback "Andarilho de <skill>" — cost: copy change.
- Ruling: XpLedgerEntry gets `skillPoints Json?` (explicit per-skill points; null → derive with skillPointsFor) so recomputeUser (Task 8) can rebuild seeded skills exactly from the ledger — plan said SkillProgress is derived — cost: one extra column.
- Ruling: Guide gets `collectibles Json` ([{name,total,description}]) instead of "Coletável:" prefix in warnings; user collectible progress not tracked in MVP (no data source) — cost: UI shows totals only.
- Ruling: author FKs and Family.owner → nullable SetNull; owner reassignment + author anonymization deferred to Plano 3 (LGPD) — cost: orphaned family owner until then.
- Ruling: security minors promoted into Task 7 fix round (exact return_to match, login CSRF state cookie, 10s fetch timeout, demo route disabled in production, response_nonce ≤5 min) — auth is security-sensitive — cost: slightly larger fix round.
- Ruling: syncUser refreshes profilePublic from getPlayerSummary each run; cron selects stalest by new lastSyncAttemptAt (User, Game) regardless of profilePublic; mission period helpers centralized in src/lib/progression/periods.ts — cost: new migration.
- Ruling: already resolved on integrated branch by Task 8's vitest `fileParallelism: false` (vitest.config.ts:21), no fix round needed — cost if wrong: flaky suite, caught at Task 13 verification.
- Ruling: accept `partialPrefetching: false` in next.config.ts — real 404 on first hit of unknown URLs matters more for SEO than partial prefetching (app uses no Link prefetch) — cost: lose PPR prefetch optimization.
- Ruling: Task 13 also strips UTF-8 BOMs and restores trailing newlines in files rewritten via PowerShell (mechanical cleanup) — cost: none.
- Ruling: no separate task review for Task 13 (verification + README + 1-line key fix); covered by final whole-branch review — cost: small.
- Ruling: hidden game details ({"response":{}}) → status private; playtime filter only if any game has playtime>0 — cost: more Steam calls for playtime-hidden users.
- Ruling: recompute derives achievement/platinum skill points from CURRENT GameSkill (XP stays frozen) — spec freezes XP not genres — cost: user skills can shift when admins re-map genres.
- Ruling: IGDB 429 → retry once then throw (game retried later via rotation) — cost: slower catalog fill.
- Ruling: skip speed-platinum check when Steam hides playtime (all games 0 min) — otherwise every real platinum would be flagged — cost: speed-platinum fraud undetectable for playtime-hidden users (burst rule still applies). Re-review dispatched.

## Pendências adiadas (minor/deferred)
- Task 1: minor (deferred): template metadata/fonts left; env invalid-value tests; boilerplate README/AGENTS.md; pnpm build-script approvals (esbuild/workerd); cacheComponents+partialPrefetching enabled in next.config.ts (later tasks must account).
- Task 1: minor (deferred): DATABASE_URL and APP_URL also fall back to dev defaults in production (env.ts:14-23) — handle in Plano 4 (deploy).
- Task 6: minor (deferred): IGDB no 401 retry; Twitch client_secret in query (per Twitch docs); no test that errors exclude secrets; SGDB Promise.all loses all art on one failure; first grid may not be portrait; HK fixture apiNames synthetic; +4 more in task-6-review.md.
- Task 6: minor (deferred): success:false with empty error → 'private'; any HTTP 400 → []; fetch-level rejection may carry URL with key (verify in final review).
- Tasks 3+4: minor (deferred): rare 20% threshold duplicated outside rarityTier; findBursts O(n*window); missing input guards in streak/xp; some untested edges; one weak assertion (see task-3-4-review.md).
- Task 2: minor (deferred): "/" shortcut ignores AltGr (ctrl+alt) on ABNT2; newsletter no error UI on reject; Escape doesn't close drawer / drawer state not reset >900px; nav links duplicated header/footer; ProgressBar label optional; footer routes 404 until later tasks; inline hex bypassing tokens.
- Task 2: minor (deferred): SearchBox aria-selected always false (focus-moving pattern); formatting oddity.
- Task 5: minor (deferred): ledger entries cannot be voided; seed has no production guard and wipes votes/progress on re-seed (must guard before Plano 4 deploy); GuideTip.votes counter without GuideVote rows; Int xp range.
- Task 7: implemented adc2e90 merged; review dispatched. Note: trailer says Sonnet 5.5 (harness attribution), left as is.
- Task 5: minor (deferred): idempotency test re-runs real seed against dev DB (not isolated).
- Task 7: minor (deferred): no route-level callback tests; first-login handle race → /?login=erro; live Steam round trip still to be tested with a real key (Plano 4).
- Task 7: minor (deferred): state compare not constant-time; openid.ns not validated; no server-side response_nonce replay store within 5-min window.
- Task 9: minor (deferred): unknown article slug → 404 UI with HTTP 200 (notFound inside Suspense; SEO impact — revisit in Plano 3); "Ver tudo" link omitted; getSessionUser called twice per request in header; getTrendingSuggestions untested; getTopPlayers public-only untested; markdown pre/img styling.
- Note: Task 11 (worktree) reads Mission by period — must use periods.ts helpers at merge time.
- Task 12: minor (deferred): createInvite doesn't reject full family / no invite cap or cleanup; concurrent double-leave → P2025 500; 12 ranking queries per view; library unpaginated; token holders see member list incl. private chip; no Server Action tests.
- Task 11: minor (deferred): toast timers not cleaned; no refresh after private result; hardcoded legendary threshold; unchecked mission casts; handle looked up twice; seed-dependent test; no syncNow test / below-top-50 path; soft 404; type widening; mute owner-only.
- Task 8: minor (deferred): syncUser overwrites displayName/avatarUrl every sync; no negative cache for games without achievements; first sync of large library inside login callback (consider next/server after()); no maxDuration on cron; no lock on concurrent recompute (UserStats briefly stale); plus 10 minors in task-8-review.md.
- Note: same soft-404 pattern exists on /noticias/[slug] (Task 9) and /jogador/[handle] (Task 11) — deferred to Plano 3 (SEO), or final review.
- Task 11: minor (deferred): UTF-8 BOM added to actions.ts, players.ts, sync/claim.ts, claim.test.ts (written via PowerShell) — strip; claim not released after private/failed sync (2-min wait).
- Note for Plano 4: `next build` needs DB reachable (generateStaticParams).
- Task 10: minor (deferred): relative dates frozen up to cache lifetime; trailing newline lost in 7 files; deviations from preview (no "Guia útil" button, no toasts, achievements sorted by commonness).
- Task 13: minor (deferred): /noticias/<unknown> soft 404 in prod; README lacks note that APP_URL must match dev port for demo redirect; screenshots skipped (agent-browser hangs).
- Deferred to Plano 4 (deploy): cron maxDuration + batch size; seed production guard; DATABASE_URL/APP_URL prod defaults; build needs DB; vercel.json crons; prod without Steam key gives fixture data on real login.
- Deferred to Plano 2: ledger entries can't be voided when later flagged as fraud (conflicts with spec §5); "Despertar" first-login level-up sequence missing from plan.
