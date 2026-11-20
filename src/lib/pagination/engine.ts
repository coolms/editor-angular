import type * as DocumentEngine from '@coolms/document-engine';

/**
 * `@coolms/document-engine`, fetched rather than imported.
 *
 * ## Why
 *
 * The engine is declared an OPTIONAL peer -- paged layout is the only thing
 * that needs it, and an editor used for ordinary rich text should not have to
 * install a 9MB font-carrying package to render a paragraph. A static import
 * made that declaration a lie: ng-packagr emits ONE fesm bundle with no code
 * splitting, so a top-level import has to resolve for every consumer while
 * `optional` tells npm not to install it. `npm install @coolms/editor-angular`
 * produced a package that could not build, and nothing said so.
 *
 * The type import above is erased at compile time and costs nothing.
 *
 * ## Why both an async and a sync accessor
 *
 * `paginateFlow` and `isFlowTable` are called from `repaginate()`, which is
 * synchronous and runs inside a `requestAnimationFrame` -- there is nowhere to
 * await. So the load is kicked off from the async edge and the sync path reads
 * {@link paginationEngine}, which is non-null only once it has arrived.
 *
 * That is not a race: `repaginate()` already returns early and re-runs when
 * the document fonts land, and this follows the same shape beside it. Every
 * synchronous consumer downstream -- `lineBoxesFrom` in the pagination
 * extension -- is reached only from that pass, so by the time it runs the
 * module is in hand.
 */
type Engine = typeof DocumentEngine;

/** Memoised on the PROMISE, so two callers await one fetch. */
let pending: Promise<Engine> | null = null;
let engine: Engine | null = null;

export function loadPaginationEngine(): Promise<Engine> {
    pending ??= import('@coolms/document-engine')
        .then((module) => {
            engine = module;

            return module;
        })
        .catch((error: unknown) => {
            // Cleared so a transient failure can be retried by the next pass
            // rather than being cached for the life of the page. A peer that
            // was never installed will simply fail again, which is correct:
            // the caller logs once and leaves the canvas unpaginated.
            pending = null;
            throw error;
        });

    return pending;
}

/**
 * The engine if it has already arrived, or null.
 *
 * For synchronous callers only. A null here means "not yet", never "not
 * installed" -- the difference is settled by whoever awaited
 * {@link loadPaginationEngine}.
 */
export function paginationEngine(): Engine | null {
    return engine;
}

/** Drop the memo. For specs, which must not inherit each other's load. */
export function resetPaginationEngine(): void {
    pending = null;
    engine = null;
}
