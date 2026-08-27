import { Table } from '@tiptap/extension-table';

/**
 * The table's own OOXML facts, carried as `data-` attributes.
 *
 * Must stay byte-identical to the constants on `TableMapper`; that mapper reads
 * them back, and the two only agree by convention.
 */
export const TABLE_WIDTH_ATTRIBUTE = 'data-width-twips';
export const TABLE_BORDER_ATTRIBUTE = 'data-border-eighths';
export const TABLE_BORDER_COLOR_ATTRIBUTE = 'data-border-color';
export const TABLE_CELL_MARGIN_ATTRIBUTE = 'data-cell-margin-twips';

/**
 * The cell margin's HORIZONTAL axis (#2308).
 *
 * The canvas paints `padding: 6px 10px` and the model carries both numbers now,
 * so the writer emits both -- the vertical under the older name above. Declared
 * here for the same reason all of these are: ProseMirror STRIPS an attribute no
 * node models, so without this line the editor would drop the horizontal margin
 * on load and the first save would send back a table that states only its
 * vertical one.
 */
export const TABLE_CELL_MARGIN_HORIZONTAL_ATTRIBUTE = 'data-cell-margin-horizontal-twips';

/** A whole number of the given unit, or null when the attribute says nothing. */
const wholeNumber = (element: HTMLElement, attribute: string): number | null => {
    const raw = Number.parseInt(element.getAttribute(attribute) ?? '', 10);

    return Number.isInteger(raw) && raw >= 0 ? raw : null;
};

/**
 * ⚠️ The attribute KEY has to be closed over, not taken as an argument.
 * Tiptap calls an attribute's `renderHTML` with the whole attribute bag and
 * nothing else — a second parameter is simply `undefined`, so `attrs[key]`
 * reads nothing and the attribute silently never renders. Measured: three of
 * these four came back missing while `borderColor`, which names its key
 * directly, survived.
 */
const numberAttribute = (key: string, attribute: string) => ({
    default: null as number | null,
    parseHTML: (element: HTMLElement): number | null => wholeNumber(element, attribute),
    renderHTML: (attrs: Record<string, unknown>): Record<string, string> => {
        const value = attrs[key];

        return 'number' === typeof value ? { [attribute]: String(value) } : {};
    },
});

/**
 * Stock Table plus the five facts a `.docx` table has and HTML does not (#2289,
 * #2308).
 *
 * ## Why these have to be modelled and not merely emitted
 *
 * ProseMirror STRIPS attributes no node declares. `DocumentHtmlWriter` writes a
 * table's own width, border weight, border colour and both cell-margin axes
 * onto the `<table>`; without the declarations below the editor drops all five
 * on load, and the save sends back a table that states nothing — so
 * `TableMapper` falls back to its authored-HTML defaults and **a borderless
 * imported table grows borders on the first save**, at a width nobody chose.
 *
 * Column widths do not need this: they ride on ProseMirror's own `colwidth`,
 * which the stock cell extension already models. These five have no such home.
 *
 * ## They are inert on the page path
 *
 * Every attribute defaults to null and renders nothing when unset, so a table
 * in ordinary page content is byte-identical to what it was before. Only a
 * document that states them carries them.
 */
export const CmsTable = Table.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            widthTwips: numberAttribute('widthTwips', TABLE_WIDTH_ATTRIBUTE),
            borderEighths: numberAttribute('borderEighths', TABLE_BORDER_ATTRIBUTE),
            cellMarginTwips: numberAttribute('cellMarginTwips', TABLE_CELL_MARGIN_ATTRIBUTE),
            cellMarginHorizontalTwips: numberAttribute(
                'cellMarginHorizontalTwips',
                TABLE_CELL_MARGIN_HORIZONTAL_ATTRIBUTE,
            ),
            borderColor: {
                default: null as string | null,
                parseHTML: (element: HTMLElement): string | null => {
                    const raw = (element.getAttribute(TABLE_BORDER_COLOR_ATTRIBUTE) ?? '').trim();

                    // ⚠️ An EMPTY value is meaningful and is not null: the
                    // writer emits `data-border-color=""` for a table whose
                    // border has no colour of its own, and losing the
                    // distinction would let the mapper's default grey back in.
                    return /^#?[0-9A-Fa-f]{6}$/.test(raw) ? raw : ('' === raw ? '' : null);
                },
                renderHTML: (attrs: Record<string, unknown>): Record<string, string> => {
                    const value = attrs['borderColor'];

                    return 'string' === typeof value ? { [TABLE_BORDER_COLOR_ATTRIBUTE]: value } : {};
                },
            },
        };
    },
});
