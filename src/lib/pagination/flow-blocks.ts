import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type {
    BlockStyle, BorderSide, BorderStyle, FlowBlock, FlowItem, FlowTable, FlowTableCell, FlowTableRow, TextSpan,
} from '@coolms/document-engine';

import { PAGE_BREAK_NODE_NAME } from '../extensions/page-break/page-break-node';

/**
 * Turning the editor's document into the engine's flow model.
 *
 * ## Positions come from ProseMirror, not from a second implementation
 *
 * Every span carries the ProseMirror position of its first character, and the
 * engine does arithmetic on those without interpreting them. ProseMirror's
 * position rules — a text node counts its UTF-16 length, a leaf counts one, a
 * container counts two plus its content — are not re-derived anywhere; they are
 * read off the real document, which is the only copy that can be right.
 *
 * That is also why inline content the engine never sees (an image, a field
 * chip) causes no drift: it sits BETWEEN spans, so the gap in positions is
 * already there in the handles.
 */

/** Marks that mean bold, across the extensions this editor ships. */
/**
 *  The mark an author's FONT choice lives on.
 *
 * The toolbar offers a family and a size per run, and neither reached the
 * engine: every character was measured with the document's base face at the
 * document's base size. MEASURED 2026-08-24 on eight paragraphs set in Courier
 * New -- the canvas drew ONE A4 sheet and the text ran **343px, nineteen
 * lines, past the bottom of it**, because a monospace face needs more lines
 * than the proportional one the engine was measuring.
 */
const TEXT_STYLE_MARK = 'coolmsTextStyle';

const BOLD_MARKS = new Set(['bold', 'strong']);
const ITALIC_MARKS = new Set(['italic', 'em']);

/**
 *  A heading holds on to what it heads.
 *
 * The engine has modelled `keepWithNext` since it could read one out of a
 * `.docx`, and nothing on this side ever set it -- so the canvas would leave a
 * heading alone at the foot of a page, and so did the file. Both are fixed
 * together: `StylesPart::headingStyle()` writes `w:keepNext`, which is what
 * Word's own heading styles carry.
 */
const HEADING_NODE = 'heading';

const TABLE_NODE = 'table';
const TABLE_ROW_NODE = 'tableRow';
const HEADER_CELL_NODE = 'tableHeader';

/** Tiptap's list nodes. A list is a CONTAINER — its text is two levels down. */
const LIST_NODES = new Set(['bulletList', 'orderedList']);
const LIST_ITEM_NODE = 'listItem';

/**
 * Containers whose height comes from the BROWSER rather than from the layout.
 *
 * Each is a box with its own padding, borders and margins — a CSS box model
 * the engine would have to reimplement to guess at. See `measureHeightAt`.
 */
const OPAQUE_NODES = new Set(['callout', 'gridLayout']);

/**
 * CSS px per typographic point — 96/72, the ratio the whole canvas is built on.
 *
 * A row height is authored and stored in POINTS, because that is the unit
 * `w:trHeight` states and the unit the control offers; the engine measures in
 * px like everything else here. One conversion, at the seam between them.
 */
const PX_PER_POINT = 96 / 72;

/**
 * The typographic box the browser gave a top-level block.
 *
 * Distinct from `measureHeightAt`, which asks for a container's WHOLE height
 * because the engine will not look inside it. This is for a block whose text the
 * engine still breaks and stacks itself: it wants the numbers the browser laid
 * out WITH, not the result.
 */
export interface BlockBox {
    /** Computed `line-height`, or null where it resolved to `normal`. */
    /**
     *  Reported but NO LONGER USED for a text block, and kept because the
     * measurement is cheap and the reason is worth stating where the value is
     * taken: a block's computed `line-height` is the LEADING, and a line box
     * grows to hold an inline box whose font is taller. Stating it made the
     * engine measure every non-base face with the base face's line.
     */
    readonly lineHeightPx: number | null;
    readonly fontSizePx: number;
    /** `font-weight` at 600 or more — the canvas paints h3 at 600. */
    readonly bold: boolean;
    /** `margin-top`, which the engine collapses against the block above. */
    readonly spaceBeforePx: number;
    readonly spaceAfterPx: number;
}

export interface FlowOptions {
    /** The writing width, for tables whose columns declare no width. */
    readonly contentWidthPx: number;
    /**
     * A cell's padding on ONE side, MEASURED from a real cell rather than
     * copied from the stylesheet.
     *
     * A constant here and a rule in the CSS is the same number written twice,
     * and a couple of pixels a row is a page every forty rows. The engine
     * decides where the page breaks and it can only be right if its rows are
     * as tall as the browser's.
     *
     *  PADDING ONLY. It used to be half of padding plus borders, which
     * the engine then applied to BOTH sides of every row -- so a collapsed rule
     * shared between two rows was counted twice. Measured: 42.90px a row
     * against the browser's 41.69. The rules have their own seam below.
     */
    readonly cellPaddingPx: number;
    /**
     * One horizontal rule of a table, measured off a real cell's border.
     *
     * The engine keeps a rule's own width as ROOM between the rows it
     * separates, which is what `border-collapse: collapse` draws: a table of N
     * rows carries N + 1 of them. Told nothing, it keeps no room at all and a
     * twenty-row table's breaks drift from the document it exports.
     */
    readonly cellBorderPx: number;
    /** What that rule is drawn AS, so the model does not invent a look. */
    readonly cellBorderStyle: BorderStyle;
    /** ...and in what colour, as `#RRGGBB`. */
    readonly cellBorderColorHex: string;
    /**
     *  Whether a face is IN HAND, not whether it is known.
     *
     * Naming a family whose bytes have not arrived makes the catalogue's reader
     * throw, and that exception lands mid-layout: the document then has no page
     * breaks at all. So a run's face is stated only once its bytes are here.
     * Until then the base face measures it -- the old answer, visibly
     * approximate, and replaced a moment later when the real one lands.
     */
    readonly faceIsLoaded?: (family: string) => boolean;
    /**
     * The bottom margin on a paragraph INSIDE a cell, measured the same way.
     *
     * Ten pixels a row the engine would otherwise not know about — a page
     * every hundred rows.
     *
     *  This said "body paragraphs in this editor have none". They have
     * exactly the same `.75em`, which is why they are measured too
     * (`measureBoxAt`). The belief that body text carried no space under it is
     * the same one that left `Normal` with no `w:spacing` in the `.docx` until
     * it was measured: the printed page ran 13.45pt a line against the canvas's
     * 21.67. Kept as its own option because a cell's paragraph could
     * legitimately differ, not because it does.
     */
    readonly cellParagraphSpaceAfterPx: number;
    /** A list's indent per level, measured from a real `ul`. */
    readonly listIndentPx: number;
    /** The bottom margin on a paragraph inside a list item. */
    readonly listParagraphSpaceAfterPx: number;
    /** The bottom margin on the list itself, which lands after its last item. */
    readonly listSpaceAfterPx: number;
    /**
     * The rendered height of the node at a document position, or null when it
     * cannot be found.
     *
     * ## Why a container is MEASURED rather than modelled
     *
     * A callout is a bordered, padded box; a grid layout is three nested boxes
     * with their own padding and collapsing margins. Reproducing that in the
     * layout means reimplementing the CSS box model one container at a time —
     * and getting it slightly wrong is invisible until the paper and the text
     * disagree several pages down.
     *
     * The browser has already computed it exactly. So these become OPAQUE boxes
     * of their measured height: the engine still decides which page each lands
     * on, but does not pretend to know what is inside. Text blocks stay
     * measured from font files, where the engine is exact and agrees with the
     * browser to the character.
     *
     * The cost is stated: a page break cannot fall INSIDE a callout or a grid,
     * exactly as a table row moves whole.
     */
    readonly measureHeightAt: (pos: number) => number | null;
    /**
     * The box the browser gave the block at a position, or null when it cannot
     * be found or reports nothing usable.
     *
     * ## Why every block is measured, not just the exotic ones
     *
 * This was defect, reported as "I press Enter and the text carries
     * on over the grey zone". A body paragraph carries `margin: 0 0 .75em` and a
     * heading `.8em 0 .4em`, and NONE of it reached the engine: a block was
     * handed over as bare spans, so the layout stacked 17.9px lines where the
     * browser stacked 28.9px paragraphs. The error is not a rounding drift, it
     * COMPOUNDS — measured on a landscape A4 page, the engine believed 61% more
     * fitted than did, and six paragraphs ran off the paper before it agreed a
     * page had ended.
     *
     * A heading was understated twice over, because its size never arrived
     * either: an `h1` is 24px on a 28.8px line and the engine drew it as body
     * text on a 17.9px one.
     *
     * The engine's own spacing model was never at fault — it collapses
     * `spaceBefore` against `spaceAfter` exactly as CSS does, measured against
     * LibreOffice. It was simply never told the numbers. So they are read from
     * the browser that already computed them, for the same reason
     * `measureHeightAt` exists: a second copy of these CSS rules here would be a
     * table of numbers that agrees with the stylesheet until someone edits one
     * of them.
     */
    readonly measureBoxAt: (pos: number) => BlockBox | null;
}

export function flowBlocksFromDoc(doc: ProseMirrorNode, options: FlowOptions): FlowItem[] {
    const items: FlowItem[] = [];
    let pageBreakPending = false;

    doc.forEach((node, offset) => {
        if (PAGE_BREAK_NODE_NAME === node.type.name) {
            // An explicit break draws nothing and occupies no line: it is an
            // instruction about the block that FOLLOWS it.
            pageBreakPending = true;

            return;
        }

        const produced = readNode(node, offset, options, 0);
        const first = produced.at(0);
        if (undefined !== first && pageBreakPending) {
            produced[0] = { ...first, pageBreakBefore: true };
        }

        items.push(...produced);
        pageBreakPending = false;
    });

    return items;
}

/**
 * One node, as the flow items it holds.
 *
 * ONE dispatch, called at every depth. Three times now a container has been
 * found reading as a single empty block — Word tables, editor tables, lists —
 * because the code that read it only looked one level down. A callout holding a
 * list holds it two levels down, and the only way that keeps working is for the
 * thing that reads a callout's children to be the same thing that reads the
 * document's.
 *
 * `indentPx` accumulates: a list inside a callout is indented by both.
 */
function readNode(
    node: ProseMirrorNode,
    offset: number,
    options: FlowOptions,
    indentPx: number,
): FlowItem[] {
    if (OPAQUE_NODES.has(node.type.name)) {
        return [opaque(node, offset, options)];
    }
    if (LIST_NODES.has(node.type.name)) {
        return readList(node, offset, options, 0, indentPx);
    }
    if (TABLE_NODE === node.type.name) {
        return [readTable(node, offset, options)];
    }

    const block = indent(
        styled(readBlock(node, offset, 0, options.faceIsLoaded), options.measureBoxAt(offset)),
        indentPx,
    );

    return [HEADING_NODE === node.type.name
        ? { ...block, style: { ...block.style, keepWithNext: true } }
        : block];
}

/** A block moved right, when it sits inside something that insets its content. */
function indent(block: FlowBlock, indentPx: number): FlowBlock {
    return 0 === indentPx
        ? block
        : { ...block, style: { ...block.style, indentLeftPx: indentPx } };
}

/**
 * A block wearing the box the browser gave it (see `measureBoxAt`).
 *
 * An unmeasurable block is left exactly as it was rather than defaulted to
 * zeroes: a block the view has not drawn yet is measured again on the next pass,
 * and zeroes would be a confident wrong answer in the meantime.
 */
function styled(block: FlowBlock, box: BlockBox | null): FlowBlock {
    if (null === box) {
        return block;
    }

    //  No line height is stated, and that is the whole point.
    //
    // The block's computed `line-height` is a CSS number: the browser's own
    // union of the strut and each run's inline box. The ENGINE's rule is
    // `max(ascender + lineGap) + max(-descender)` over the runs, which was
    // measured against LibreOffice at 11 of 11. Handing the CSS number
    // over makes the engine honour it through the `auto` branch and throw its
    // own rule away.
    //
    // MEASURED 2026-08-25 at 11pt, per paragraph including its spacing: the
    // canvas DRAWS 22.266pt, the engine told the CSS number computes 21.674,
    // and LibreOffice PRINTS 21.800. Saying nothing puts the engine on 21.80.
    //
 // An earlier attempt tried this and reverted it: the document came out with two
    // pages and no gap between them. Two things have changed since -- the
    // engine's rule itself was wrong then, and the faces a document
    // names were being painted by whatever the machine had. The
 // instrument that can tell breaks apart is the, not a screenshot.
    //
    // The SIZE and the spacing still travel: no face metric supplies those.
    return {
        ...block,
        style: {
            ...block.style,
            fontSizePx: box.fontSizePx,
            bold: box.bold,
            spaceBeforePx: box.spaceBeforePx,
            spaceAfterPx: box.spaceAfterPx,
        },
    };
}

/** A text block: its spans, each with the position of its first character. */
function readBlock(
    node: ProseMirrorNode,
    offset: number,
    spaceAfterPx = 0,
    faceIsLoaded?: (family: string) => boolean,
): FlowBlock {
    // `offset + 1` steps inside the block, where its first child sits.
    const contentStart = offset + 1;
    const spans: TextSpan[] = [];

    node.forEach((child, childOffset) => {
        if (!child.isText || undefined === child.text) {
            // A non-text inline node still occupies positions, which is
            // exactly what keeps the NEXT span's handle correct.
            return;
        }

        spans.push({
            text: child.text,
            bold: child.marks.some((mark) => BOLD_MARKS.has(mark.type.name)),
            italic: child.marks.some((mark) => ITALIC_MARKS.has(mark.type.name)),
            at: contentStart + childOffset,
            ...runStyle(child, faceIsLoaded),
        });
    });

    return {
        spans,
        at: contentStart,
        ...(0 === spaceAfterPx ? {} : { style: { spaceAfterPx } }),
    };
}

/**
 * The face and size one run asked for, in the engine's units.
 *
 *  The mark keeps a size in POINTS -- the unit the `.docx` speaks and the
 * one the toolbar shows -- and the engine measures in px. Converting here
 * rather than at either end keeps the mark's own comment true: a document that
 * round-trips through a browser keeps the size the author chose.
 *
 * Absent stays ABSENT, never zero or a default: the flow's base style answers
 * for a run that asked for nothing, and a stated default here would override a
 * document's own.
 */
function runStyle(
    node: ProseMirrorNode,
    faceIsLoaded?: (family: string) => boolean,
): { fontFamily?: string; fontSizePx?: number } {
    const mark = node.marks.find((candidate) => TEXT_STYLE_MARK === candidate.type.name);
    if (undefined === mark) {
        return {};
    }

    const attrs = mark.attrs as { fontFamily?: string | null; fontSize?: number | null };
    const family = 'string' === typeof attrs.fontFamily && '' !== attrs.fontFamily.trim()
        ? attrs.fontFamily.trim()
        : null;
    const sizePt = 'number' === typeof attrs.fontSize && attrs.fontSize > 0 ? attrs.fontSize : null;

    //  A face nobody has fetched is not named: see `faceIsLoaded`.
    const usable = null !== family && (undefined === faceIsLoaded || faceIsLoaded(family));

    return {
        ...(usable && null !== family ? { fontFamily: family } : {}),
        ...(null === sizePt ? {} : { fontSizePx: sizePt * PX_PER_POINT }),
    };
}

/**
 * Every font family the document NAMES, so the catalogue can be asked for them.
 *
 * The engine falls back to the base face for a family it does not hold, which
 * is a silent change to the page count -- so the families are collected before
 * the layout runs rather than discovered by a wrong answer.
 */
export function fontFamiliesIn(doc: ProseMirrorNode): string[] {
    const found = new Set<string>();

    doc.descendants((node) => {
        const family = runStyle(node).fontFamily;
        if (undefined !== family) {
            found.add(family);
        }

        return true;
    });

    return [...found];
}

/**
 * A list, flattened into the blocks it holds.
 *
 * Each item's paragraph becomes a block of its own, indented by its nesting
 * depth: pagination only cares how much text there is and how wide the column
 * is, and a bullet occupies neither. The marker is the browser's `list-style`
 * and needs nothing from here.
 *
 * Depth is counted rather than measured because a nested list's `ul` sits
 * inside its parent's, so its indent is the parent's plus one more.
 */
function readList(
    node: ProseMirrorNode,
    offset: number,
    options: FlowOptions,
    depth: number,
    inheritedPx: number,
): FlowBlock[] {
    const blocks: FlowBlock[] = [];
    const indentLeftPx = inheritedPx + options.listIndentPx * (depth + 1);

    node.forEach((item, itemOffset) => {
        if (LIST_ITEM_NODE !== item.type.name) {
            return;
        }

        // +1 into the list, +1 into the item.
        const itemStart = offset + 1 + itemOffset + 1;

        item.forEach((child, childOffset) => {
            if (LIST_NODES.has(child.type.name)) {
                blocks.push(...readList(child, itemStart + childOffset, options, depth + 1, inheritedPx));

                return;
            }

            const block = readBlock(
                child,
                itemStart + childOffset,
                options.listParagraphSpaceAfterPx,
                options.faceIsLoaded,
            );
            blocks.push({
                ...block,
                style: { ...block.style, indentLeftPx },
            });
        });
    });

    // The list's own bottom margin lands after its last item, not after each.
    const last = blocks.at(-1);
    if (undefined !== last) {
        blocks[blocks.length - 1] = {
            ...last,
            style: { ...last.style, spaceAfterPx: options.listSpaceAfterPx },
        };
    }

    return blocks;
}

/**
 * A container as one box of its rendered height.
 *
 * A paragraph with no text and a fixed line height is exactly that: one line,
 * that tall, that breaks as a unit. Nothing else in the layout needs to know it
 * is special.
 *
 * A container that cannot be measured — one the view has not drawn yet — falls
 * back to reading its blocks, which is wrong by the box's own padding but is
 * never zero.
 */
function opaque(node: ProseMirrorNode, offset: number, options: FlowOptions): FlowBlock {
    const heightPx = options.measureHeightAt(offset);
    // The height above is the border box — `getBoundingClientRect()` stops at
    // the border, so a callout's own margins are as invisible to the layout as
    // a paragraph's were.
    const box = options.measureBoxAt(offset);
    const style: BlockStyle = {
        ...(null === heightPx || heightPx <= 0 ? {} : { lineHeightPx: heightPx }),
        ...(null === box ? {} : { spaceBeforePx: box.spaceBeforePx, spaceAfterPx: box.spaceAfterPx }),
    };

    return {
        spans: [],
        at: offset + 1,
        ...(0 === Object.keys(style).length ? {} : { style }),
    };
}

/**
 * A table.
 *
 * ## Column widths
 *
 * ProseMirror stores them per CELL, in a `colwidth` array — one entry per grid
 * column the cell spans, and null when the column has never been resized. The
 * columns that carry no width share out whatever the sized ones leave, which is
 * what the browser's `table-layout: fixed` does with the same data. Measuring
 * anything else would put the engine's line breaks in different places from the
 * cells the user is looking at.
 */
function readTable(node: ProseMirrorNode, offset: number, options: FlowOptions): FlowTable {
    const rows: FlowTableRow[] = [];
    // A map rather than a sparse array: "this column has no width yet" and
    // "this column is null wide" are different things, and an array cannot
    // tell them apart without leaning on undefined.
    const declared = new Map<number, number>();

    node.forEach((rowNode, rowOffset) => {
        if (TABLE_ROW_NODE !== rowNode.type.name) {
            return;
        }

        const cells: FlowTableCell[] = [];
        let column = 0;

        rowNode.forEach((cellNode, cellOffset) => {
            // `colwidth` holds one entry per spanned column and a NULL for any
            // that has never been resized — so a spanning cell can declare one
            // of its columns and leave the other to share out.
            const attrs = cellNode.attrs as { colspan?: number; colwidth?: (number | null)[] | null };
            const span = Math.max(1, attrs.colspan ?? 1);
            const widths = attrs.colwidth ?? null;

            for (let index = 0; index < span; index++) {
                const width = null === widths || index >= widths.length ? null : widths[index];
                // First declaration wins, so a later row cannot narrow a
                // column the user has already sized.
                if (null !== width && !declared.has(column + index)) {
                    declared.set(column + index, width);
                }
            }

            const blocks: FlowBlock[] = [];
            // +1 for the row's own opening token, +1 for the cell's.
            const cellStart = offset + 1 + rowOffset + 1 + cellOffset;
            cellNode.forEach((paragraph, paragraphOffset) => {
                blocks.push(readBlock(
                    paragraph,
                    cellStart + 1 + paragraphOffset,
                    options.cellParagraphSpaceAfterPx,
                ));
            });

            cells.push({
                blocks,
                gridSpan: span,
                ...(HEADER_CELL_NODE === cellNode.type.name ? { isHeader: true } : {}),
            });
            column += span;
        });

        // A row height the author set, in points, as the engine's px. Without
        // this the canvas would break its pages where an UNSET row would fall
        // and the .docx where the stated one does — the two disagreeing about
        // the same table, which is the whole thing a paged editor exists to
        // prevent.
        const attrs = rowNode.attrs as { height?: number | null; repeatHeader?: boolean };
        const height = attrs.height;
        rows.push({
            cells,
            //  Stated, not derived from the cells being `<th>`. The engine
            // falls back to that derivation for callers that have no such
            // attribute, and the derivation was wrong in one direction: the
            // canvas repeated a header row the `.docx` never did, because
 // nothing wrote `w:tblHeader` until a later fix. Sending the author's
            // real answer is what makes the two agree.
            repeatHeader: true === attrs.repeatHeader,
            ...('number' === typeof height && height > 0 ? { heightPx: height * PX_PER_POINT } : {}),
        });
    });

    // The rule is ROOM before it is ink, and the engine has its own seam for
    // it -- so it is declared here rather than smuggled into the padding. Every
    // side takes the same width because the editor's CSS draws one border on
    // every cell; a document whose cells differ is not something this surface
    // can express.
    //
    // Only the WIDTH is room; the colour and the style are carried because a
    // border is those three things, and nothing on this canvas paints from the
    // model -- the browser draws the table itself. Measured rather than chosen
    // all the same, so the model is never a description of a table that is not
    // on the screen.
    const rule: BorderSide = {
        widthPx: options.cellBorderPx,
        style: options.cellBorderStyle,
        colorHex: options.cellBorderColorHex,
    };

    return {
        rows,
        columnWidthsPx: shareOut(declared, columnCount(rows), options.contentWidthPx),
        cellPaddingPx: options.cellPaddingPx,
        ...(0 < options.cellBorderPx
            ? { borders: { top: rule, bottom: rule, left: rule, right: rule, insideH: rule, insideV: rule } }
            : {}),
        at: offset + 1,
    };
}

/**
 * Where one table row's own node begins.
 *
 * The position `view.nodeDOM()` answers the row's `<tr>` for -- which is how
 * the canvas gets at a header row it has to draw again at the top of a page.
 *
 * Null when the block is not a table or the row is gone, which is what happens
 * for a frame after an edit removes rows.
 */
export function rowPositionOf(doc: ProseMirrorNode, blockIndex: number, rowIndex: number): number | null {
    return atRow(doc, blockIndex, rowIndex, (_rowNode, rowStart) => rowStart);
}

/**
 * Walk to one row of one flow block and hand it to `visit`.
 *
 * Counted the way flowBlocksFromDoc counts: a page-break node produces no item,
 * so the document's child index and the flow's block index diverge after the
 * first break.
 */
function atRow<T>(
    doc: ProseMirrorNode,
    blockIndex: number,
    rowIndex: number,
    visit: (rowNode: ProseMirrorNode, rowStart: number) => T,
): T | null {
    let itemIndex = 0;
    let found: T | null = null;

    doc.forEach((node, offset) => {
        if (PAGE_BREAK_NODE_NAME === node.type.name) {
            return;
        }

        const current = itemIndex++;
        if (current !== blockIndex || TABLE_NODE !== node.type.name) {
            return;
        }

        let seen = 0;
        node.forEach((rowNode, rowOffset) => {
            if (TABLE_ROW_NODE !== rowNode.type.name || seen++ !== rowIndex) {
                return;
            }

            found = visit(rowNode, offset + 1 + rowOffset);
        });
    });

    return found;
}

/** The widest row decides how many grid columns the table has. */
function columnCount(rows: readonly FlowTableRow[]): number {
    let widest = 0;
    for (const row of rows) {
        widest = Math.max(widest, row.cells.reduce((sum, cell) => sum + (cell.gridSpan ?? 1), 0));
    }

    return widest;
}

/**
 * Give every column a width: the one it declared, or an equal share of what is
 * left over.
 *
 * A table where nothing has been resized therefore divides the writing width
 * evenly, which is what it looks like on screen.
 */
function shareOut(declared: ReadonlyMap<number, number>, columns: number, contentWidthPx: number): number[] {
    if (0 === columns) {
        return [];
    }

    const widths: (number | null)[] = [];
    for (let index = 0; index < columns; index++) {
        widths.push(declared.get(index) ?? null);
    }

    const spoken = widths.reduce<number>((sum, width) => sum + (width ?? 0), 0);
    const silent = widths.filter((width) => null === width).length;
    // Never negative: a table resized wider than the page still has to lay out.
    const each = 0 === silent ? 0 : Math.max(1, (contentWidthPx - spoken) / silent);

    return widths.map((width) => width ?? each);
}
