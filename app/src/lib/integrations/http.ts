/** Upper bound for any single outbound request to an integration (Steam, IGDB, RAWG, SGDB). */
export const FETCH_TIMEOUT_MS = 10_000;

/**
 * OpenXBL is slower: per-title reads of one player kept passing 10 s (8 timeouts in 4 days,
 * 2026-11-01..04), each title then waiting for the next sync.
 */
export const XBOX_FETCH_TIMEOUT_MS = 20_000;

/** A fresh abort signal for one request, so a hung upstream never hangs a sync or a login. */
export const timeoutSignal = (ms = FETCH_TIMEOUT_MS) => AbortSignal.timeout(ms);
