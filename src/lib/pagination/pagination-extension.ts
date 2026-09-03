import { Extension } from '@tiptap/core';
import type { FlowItem, PlacedLine, PlacedRow } from '@coolms/document-engine';

import { paginationEngine } from './engine';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * The page gaps, drawn as ProseMirror decorations.
 *
 * ## Why a decoration and not a DOM edit
 *
 * The gaps are presentation, not content: they must not appear in the HTML the
 * editor saves, must not survive a copy, and must not be something the caret can
 * land inside. A decoration is all three by construction. Writing the same
 * spacer into the DOM directly would be clobbered the moment ProseMirror redrew
 * the node, and can corrupt its view in the meantime.
 *
 * ## One mechanism for both kinds of break
 *
 * A gap between two blocks and a gap part-way through a paragraph are the same
 * thing here: a block-level widget at a position. Between blocks it pushes the
 * next block down; inside a paragraph `display: block` ends the current line and
 * the rest of the text continues below the gap — which is what reflowing a
 * paragraph across a page boundary looks like.
 */

export interface PageGap {
    /** ProseMirror position at which the new page begins. */
    readonly pos: number;
    /** How far the content must be pushed to clear the page break. */
    readonly heightPx: number;
    /** Index of the page this gap opens, so a correction pass can find it. */
    readonly page: number;
    /**
     * Set when the gap opens a page inside a TABLE: how many grid columns the
     * spacer row has to span.
     */
    readonly columns?: number;
    /**
     * The table header rows to draw again under this gap, as the `<tr>` markup
     * of the rows they copy.
     *
     * MARKUP and not elements, because this rides in plugin STATE: a live node
     * held there would be one the editor could not map, redraw or discard with
     * the rest of the gap. The view builds the row from it.
     */
    readonly headerRows?: readonly string[];
}

export const paginationKey = new PluginKey<PageGap[]>('coolmsPagination');

/**
 * The line box the ENGINE computed for one block.
 *
 *  `pos` is the BLOCK's own position -- the one `nodeDOM()` takes -- not its
 * content start. A flow item's `at` is the content start, so the caller passes
 * `at - 1`.
 */
export interface LineBox {
    readonly pos: number;
    readonly heightPx: number;
}

/**
 *  A DECORATION, not an attribute somebody sets on the DOM.
 *
 * Writing `style` and `data-` straight onto `view.nodeDOM()` works for exactly
 * as long as ProseMirror leaves that element alone. MEASURED: the pass reported
 * 130 of 130 blocks styled and a query for the attribute immediately afterwards
 * found **0** -- the decoration dispatch re-renders every node it touches and
 * takes the attributes with it. A decoration is re-applied by ProseMirror on
 * every render, so it cannot be wiped by one.
 */
export const lineBoxKey = new PluginKey<LineBox[]>('coolmsLineBoxes');

/**
 * The line box the ENGINE computed, per block, for the browser to DRAW.
 *
 * ## Why this is not "set line-height and be done"
 *
 * The engine's rule is `max(ascender + lineGap) + max(-descender)` -- each
 * side of the baseline maxed on its own, measured against LibreOffice at
 * 11 of 11. CSS has a different model: it gives every inline box
 * the stated height by splitting the leading HALF above and HALF below ITS
 * OWN content area, so two faces on one line end up at different offsets
 * and their union is taller than either.
 *
 * MEASURED with `tools/line-box-probe.html` at 11pt, px, for Carlito alone
 * / Carlito + Liberation Mono / Liberation Serif + Mono:
 *
 *     line-height: normal (before)   17.600 / 18.400 / 18.400
 *     H on the block only            17.900 / 19.975 / 19.700
 *     H on block AND runs            17.900 / 19.975 / 19.700
 *     runs at 0, block at H          17.900 / 18.375 / 18.100
 *     the engine's H                 17.904 / 18.369 / 18.097
 *
 * Only the fourth row lands, and it lands within 0.006px. The CSS beside
 * `--cms-line-box` is the other half of it.
 *
 *  The error ran in BOTH directions before this. A single-face page drew
 * 0.304px SHORT a line and a serif+mono page 0.303px LONG -- which is
 * exactly the measured "ends 17.1px above the bottom margin" and "8.5px below
 * it". One change, both pages.
 *
 *  Table cells too, and the mapping is CHECKED
 *
 * `PlacedLine.paragraphIndex` indexes the TOP-LEVEL flow items, so a table is
 * one item and its cells' paragraphs are invisible to that walk. Their boxes
 * exist on `PlacedCell.lines`, indexed relative to the cell, and the second
 * pass below reaches them by mapping a placed cell back to its source cell BY
 * INDEX -- verified against the cell COUNT, because a `w:vMerge` expansion
 * inserts cells no source cell answers to. A row whose counts disagree is
 * skipped: losing a box costs a fraction of a pixel, and putting one
 * paragraph's height on another would move text.
 *
 *  A table nested inside a cell is still not reached. `PlacedCell.rows`
 * holds it, and the recursion is one more level than this needs today.
 *
 * The CSS is scoped by the attribute the decoration sets rather than written
 * against `.ProseMirror p`, so anything this does not reach keeps what it had
 * -- a rule that zeroed runs the engine never measured would leave them
 * drawing an inherited number and call it a fix.
 *
 *  And CSS has ONE line-height per block. A paragraph whose LINES use
 * different face sets is drawn on its TALLEST, which is the only choice
 * that cannot make text overlap.
 *
 * ## It settles rather than oscillates
 *
 * Setting this changes the block's rendered height, and the next pass
 * measures that. It converges anyway: a paragraph's engine line box is
 * computed from its runs' FONT METRICS and size, not from the height the
 * browser reported -- `styled()` stopped passing that -- so the
 * second pass computes the same number and asks for it again.
 *
 * @returns one entry per measured block, at the BLOCK's own position
 */
export function lineBoxesFrom(
    items: readonly FlowItem[],
    pages: readonly {
        readonly lines: readonly PlacedLine[];
        readonly rows?: readonly PlacedRow[];
    }[],
): LineBox[] {
    // The engine is an optional peer, loaded on demand. Null cannot happen on
    // the real path -- this is only ever reached from `repaginate()`, which
    // returns early until the module has arrived, and its `pages` argument is
    // the engine's own output. The guard is here so a caller that has not gone
    // through that pass gets no boxes rather than a crash.
    const engine = paginationEngine();
    if (null === engine) return [];
    const { isFlowTable } = engine;

    const tallest = new Map<number, number>();
    for (const page of pages) {
        for (const placed of page.lines) {
            const seen = tallest.get(placed.paragraphIndex) ?? 0;
            if (placed.heightPx > seen) {
                tallest.set(placed.paragraphIndex, placed.heightPx);
            }
        }
    }

    const boxes: LineBox[] = [];
    for (const [index, heightPx] of tallest) {
        const item = items[index];
        if (undefined === item || isFlowTable(item)) continue;

        // `at` is the block's CONTENT start, one past the node itself --
        // the same offset `measureHeightAt()` is handed, plus one.
        const at = item.at;
        if (undefined === at || !Number.isFinite(at) || heightPx <= 0) continue;

        boxes.push({ pos: at - 1, heightPx });
    }

    
    // -- the paragraphs inside table CELLS --------------------------------
    //
    //  `PlacedLine.paragraphIndex` at the top level indexes the flow ITEMS,
    // so a table is one item and its cells' paragraphs are invisible to the
    // walk above. Their boxes exist -- `PlacedCell.lines` carries them, indexed
    // relative to the cell -- but reaching them means mapping a placed cell
    // back to the source cell that produced it.
    //
    //  That mapping is by INDEX, and it is CHECKED rather than trusted. A row
    // the layout expanded -- a `w:vMerge` continuation inserts cells that no
    // source cell answers to -- no longer lines up, and an index that has
    // silently shifted would put one paragraph's line height on another's. When
    // the counts disagree the row is skipped, which loses a box; assigning the
    // wrong one would lose the text.
    for (const page of pages) {
        for (const row of page.rows ?? []) {
            // A repeated header is the SAME source row drawn again. Its blocks
            // already have their box from the row itself.
            if (row.repeated) continue;

            const table = items[row.blockIndex];
            if (undefined === table || !isFlowTable(table)) continue;

            const sourceRow = table.rows[row.rowIndex];
            if (undefined === sourceRow || sourceRow.cells.length !== row.cells.length) continue;

            row.cells.forEach((placed, cellIndex) => {
                const blocks = sourceRow.cells[cellIndex]?.blocks ?? [];

                const tallestInCell = new Map<number, number>();
                for (const line of placed.lines) {
                    const seen = tallestInCell.get(line.paragraphIndex) ?? 0;
                    if (line.heightPx > seen) {
                        tallestInCell.set(line.paragraphIndex, line.heightPx);
                    }
                }

                for (const [index, heightPx] of tallestInCell) {
                    const block = blocks[index];
                    if (undefined === block || isFlowTable(block)) continue;

                    const cellAt = block.at;
                    if (undefined === cellAt || !Number.isFinite(cellAt) || heightPx <= 0) continue;

                    boxes.push({ pos: cellAt - 1, heightPx });
                }
            });
        }
    }

    return boxes;
}

export function createPagination(): Extension {
    return Extension.create({
        name: 'coolmsPagination',

        addProseMirrorPlugins() {
            return [
                new Plugin<PageGap[]>({
                    key: paginationKey,
                    state: {
                        init: (): PageGap[] => [],
                        apply: (transaction, current): PageGap[] => {
                            const replacement = transaction.getMeta(paginationKey) as PageGap[] | undefined;
                            if (undefined !== replacement) {
                                return replacement;
                            }
                            if (!transaction.docChanged) {
                                return current;
                            }

                            // Keep the gaps attached to their text until the next
                            // measurement arrives. Without mapping, a gap sits at
                            // a stale offset for one frame and visibly jumps.
                            return current.map((gap) => ({
                                ...gap,
                                pos: transaction.mapping.map(gap.pos),
                            }));
                        },
                    },
                    props: {
                        decorations(state) {
                            const gaps = paginationKey.getState(state) ?? [];
                            if (0 === gaps.length) {
                                return DecorationSet.empty;
                            }

                            const limit = state.doc.content.size;
                            const decorations = gaps
                                // A position past the end of a document that has
                                // just shrunk would throw rather than draw.
                                .filter((gap) => gap.pos >= 0 && gap.pos <= limit && gap.heightPx > 0)
                                .flatMap((gap) => [
                                    // Before the content at this position, so the
                                    // character the page starts with lands after
                                    // the gap rather than above it.
                                    //
                                    // Not part of the document: never copied, never
                                    // serialised, never a place the caret can go.
                                    Decoration.widget(gap.pos, () => pageGapElement(gap), {
                                        side: GAP_SIDE,
                                        ignoreSelection: true,
                                    }),
                                    //  EXPLICIT sides rather than insertion order: these
                                    // all sit at one position, and a header drawn
                                    // above the gap that opens its page would be a
                                    // header on the wrong page.
                                    ...(gap.headerRows ?? []).map((html, index) =>
                                        Decoration.widget(gap.pos, () => repeatedHeaderElement(html), {
                                            side: GAP_SIDE + 1 + index,
                                            ignoreSelection: true,
                                        })),
                                ]);

                            return DecorationSet.create(state.doc, decorations);
                        },
                    },
                }),
                new Plugin<LineBox[]>({
                    key: lineBoxKey,
                    state: {
                        init: (): LineBox[] => [],
                        apply: (transaction, current): LineBox[] => {
                            const replacement = transaction.getMeta(lineBoxKey) as LineBox[] | undefined;
                            if (undefined !== replacement) {
                                return replacement;
                            }
                            if (!transaction.docChanged) {
                                return current;
                            }

                            // Mapped for the same reason the gaps are: a block
                            // keeps its box until the next measurement arrives,
                            // rather than losing it for a frame while the author
                            // types.
                            return current.map((box) => ({
                                ...box,
                                pos: transaction.mapping.map(box.pos),
                            }));
                        },
                    },
                    props: {
                        decorations(state) {
                            const boxes = lineBoxKey.getState(state) ?? [];
                            if (0 === boxes.length) {
                                return DecorationSet.empty;
                            }

                            const limit = state.doc.content.size;
                            const decorations: Decoration[] = [];
                            for (const box of boxes) {
                                if (box.pos < 0 || box.pos >= limit || box.heightPx <= 0) {
                                    continue;
                                }

                                // A position that no longer holds a block -- the
                                // author deleted it between the measurement and
                                // this render -- is skipped rather than guessed.
                                const node = state.doc.nodeAt(box.pos);
                                if (null === node || !node.isBlock) {
                                    continue;
                                }

                                decorations.push(Decoration.node(box.pos, box.pos + node.nodeSize, {
                                    'data-cms-line-box': '',
                                    style: '--cms-line-box:' + box.heightPx + 'px',
                                }));
                            }

                            return DecorationSet.create(state.doc, decorations);
                        },
                    },
                }),
            ];
        },
    });
}

/**
 * Where the gap sits among the widgets at its position.
 *
 * Room enough below zero for the header rows that follow it, and still before
 * the content the page starts with.
 */
const GAP_SIDE = -10;

/**
 * What a gap is DRAWN as.
 *
 * Two shapes: a block between blocks, and a ROW inside a table. Exported so the
 * shapes can be pinned without a document -- they are the half of this seam a
 * decoration cannot describe.
 */
export function pageGapElement(gap: PageGap): HTMLElement {
    const element = document.createElement(undefined === gap.columns ? 'div' : 'tr');
    element.className = 'cms-page-gap';
    element.setAttribute('aria-hidden', 'true');
    element.dataset['page'] = String(gap.page);

    if (undefined === gap.columns) {
        element.style.height = `${gap.heightPx}px`;

        return element;
    }

    const cell = document.createElement('td');
    cell.colSpan = gap.columns;
    cell.style.height = `${gap.heightPx}px`;
    element.append(cell);

    return element;
}

/**
 * A table header row, drawn again at the top of a page the table continues onto.
 *
 * The markup is the author's own row's, so the columns, borders, backgrounds and
 * text are the ones on the screen and cannot drift from them.
 *
 *  A `<template>`, and that is the whole of it. Measured 2026-08-24:
 * `div.innerHTML = '<tr><th><p>Item</p></th></tr>'` answers `<p>Item</p>` --
 * the row and its cells are DISCARDED, because a row is only allowed in table
 * content. A template element parses table fragments as themselves, so the row
 * survives with its widths and its header marker. Wrapping the markup in a
 * `<table>` first is not what saves it and was removed once a mutation proved
 * so.
 */
export function repeatedHeaderElement(html: string): HTMLElement {
    const template = document.createElement('template');
    template.innerHTML = html;
    const row = template.content.querySelector('tr');
    const element = row ?? document.createElement('tr');
    element.classList.add('cms-repeat-header');
    element.setAttribute('aria-hidden', 'true');

    return element;
}

/**
 * The element carrying a gap's height.
 *
 * A gap inside a table is a ROW, and a row is as tall as its cells -- so the
 * height lives on the cell, and a correction pass has to write it there.
 */
export function gapHeightHost(element: HTMLElement): HTMLElement {
    return 'TR' === element.tagName && element.firstElementChild instanceof HTMLElement
        ? element.firstElementChild
        : element;
}
