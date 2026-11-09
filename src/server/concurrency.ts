/**
 * Bounded-concurrency work, for the places that would otherwise be a sequential
 * `await` inside a `for` loop over every row of an import.
 *
 * Two ceilings make this matter, and they are both hard:
 *
 *   Static Web Apps caps a request at 45 seconds and will not raise it.
 *   The Cosmos free tier grants 1,000 RU/s for the whole account.
 *
 * Sequentially, an import pays full network latency per row and finishes in
 * `rows x latency`. Concurrently it finishes in whatever the RU budget allows,
 * which is the real limit and a far higher one. At ~7 RU per small upsert,
 * 2,000 rows is ~14,000 RU - about 14 seconds of throughput, against ~45+
 * seconds of round trips done one at a time.
 */

/** How many writes to have in flight. High enough to hide latency, low enough to be polite to a 1,000 RU/s budget. */
export const DEFAULT_CONCURRENCY = 20;

/**
 * Map over items with at most `limit` promises in flight, preserving order.
 *
 * Unlike `Promise.all(items.map(...))` this does not open every connection at
 * once, which on a throughput-capped account produces a burst of 429s and ends
 * up slower than doing less at a time.
 */
export async function mapLimit<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) return [];

    const results = new Array<R>(items.length);
    let next = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await fn(items[index], index);
        }
    });

    await Promise.all(workers);
    return results;
}
