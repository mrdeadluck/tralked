/** Upper bound for any single outbound request to an integration (Steam, IGDB, RAWG, SGDB). */
export const FETCH_TIMEOUT_MS = 10_000;

/** A fresh abort signal for one request, so a hung upstream never hangs a sync or a login. */
export const timeoutSignal = () => AbortSignal.timeout(FETCH_TIMEOUT_MS);
