import type { PlacedRow } from '@coolms/document-engine';

/**
 * A table header row the ENGINE repeated at the top of a page.
 *
 * ProseMirror draws the table ONCE, so the row the `.docx` and the PDF repeat
 * on every continuation page has nowhere on the canvas to come from -- the
 * engine kept a row's worth of room at the top of each of those pages and the
 * canvas left it blank. This is what the canvas needs in order to draw its own
 * copy: which rows, and on which page.
 *
 * There is no height here on purpose. The room a page has to leave is the
 * room the DRAWN copy takes, so it is measured off that copy once it exists --
 * see `repeatedHeaderElements`.
 */
export interface RepeatedHeader {
    /** Index of the page the header is drawn AGAIN at the top of. */
    readonly page: number;
    /** Index of the table among the flow's blocks. */
    readonly blockIndex: number;
    /** The leading rows that repeat, in document order. */
    readonly rowIndexes: readonly number[];
}

/**
 * The header rows the engine repeated, page by page.
 *
 * The ENGINE decides WHICH rows repeat: it is what broke the table, and the
 * `.docx` and the PDF get the same answer out of the same code. Deriving it
 * again here would be a second opinion about a question already answered --
 * and one that could disagree, which is the whole defect #2294 fixed.
 */
export function repeatedHeadersOf(
    pages: readonly { readonly rows: readonly PlacedRow[] }[],
): RepeatedHeader[] {
    const headers: RepeatedHeader[] = [];

    pages.forEach((page, index) => {
        const rows = page.rows.filter((row) => row.repeated);
        if (0 === rows.length) {
            return;
        }

        headers.push({
            page: index,
            blockIndex: rows[0].blockIndex,
            rowIndexes: rows.map((row) => row.rowIndex),
        });
    });

    return headers;
}
