/** Shared stop flag: once a call fails, no worker starts another (paid) call. */
export type Abort = { aborted: boolean };

/**
 * Runs `run` over `list` with at most `limit` calls at a time, keeping the order of the results. On the first
 * error the abort flag is set, the workers stop pulling new items, and the error is rethrown.
 */
export async function inPool<T, R>(list: T[], limit: number, run: (x: T) => Promise<R>, abort: Abort = { aborted: false }): Promise<R[]> {
  const out = new Array<R>(list.length);
  let next = 0;
  const worker = async () => {
    while (!abort.aborted && next < list.length) {
      const i = next++;
      try {
        out[i] = await run(list[i]!);
      } catch (error) {
        abort.aborted = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

/** Sets the abort flag when `promise` fails (for a call that runs beside a pool). */
export function abortOnError<T>(promise: Promise<T>, abort: Abort): Promise<T> {
  return promise.catch((error: unknown) => {
    abort.aborted = true;
    throw error;
  });
}
