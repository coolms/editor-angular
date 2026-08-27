import { TableRow } from '@tiptap/extension-table-row';

/**
 * A table row that can carry a height (#2086).
 *
 * The stock `@tiptap/extension-table-row` has no attributes at all; this adds
 * one, `height`, in POINTS — the unit Word states `w:trHeight` in and the unit
 * the toolbar speaks, so the number an author types is the number the file
 * stores with no conversion in between to get wrong.
 *
 * ## Why `data-height` and not `style="height:…"`
 *
 * The same reason {@link ./table-cell} uses a class for alignment: the
 * server-side `HtmlProfileSanitizer` deliberately allows no `style` attribute
 * anywhere in the table family, because it would reopen CSS injection. Unlike
 * alignment there is no small set of values to map onto classes — a height is a
 * number — so it goes in a `data-` attribute, which is inert.
 *
 * ⚠️ A sanitised surface does not carry it. `<tr>` is whitelisted with NO
 * attributes, so a table pasted into a page body keeps its rows and loses their
 * heights. That is deliberate and already the rule for column widths: a
 * `w:trHeight` is a fact about a PRINTED page and means nothing in a web
 * layout, where the row is as tall as its content whatever the file says.
 * Documents do not pass through that sanitizer, which is where the attribute
 * has to survive and does.
 */
/** The attribute a repeating header row carries. Mirrors `TableMapper::ROW_REPEAT_ATTRIBUTE`. */
export const REPEAT_HEADER_ATTRIBUTE = 'data-repeat-header';

export const CmsTableRow = TableRow.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            /**
             * `w:tblHeader` — "repeat this row at the top of every page"
             * (#2294).
             *
             * ⚠️ A row ATTRIBUTE and not a `<thead>`, because ProseMirror's
             * table schema has no thead node: it serialises rows straight into
             * a `<tbody>`, so a `<thead>` would parse and then vanish on the way
             * back out, taking the setting with it on the first save.
             *
             * ⚠️ And a BOOLEAN attribute — its presence is the fact. Rendering
             * `="true"` would work until the serializer normalised it, and a
             * reader comparing values would then find `""` and read it as off.
             *
             * Separate from whether the row's cells are `<th>`: a header row
             * need not repeat, and Word does not make one repeat until asked.
             */
            repeatHeader: {
                default: false,
                keepOnSplit: false,
                parseHTML: (element: HTMLElement): boolean => element.hasAttribute(REPEAT_HEADER_ATTRIBUTE),
                renderHTML: (attrs: Record<string, unknown>): Record<string, string> =>
                    (true === attrs['repeatHeader'] ? { [REPEAT_HEADER_ATTRIBUTE]: '' } : {}),
            },
            height: {
                default: null as number | null,
                parseHTML: (element: HTMLElement): number | null => {
                    const raw = Number.parseFloat(element.getAttribute('data-height') ?? '');

                    // Positive only. Zero or a negative would render as a row
                    // nobody can see or click into, and a document carrying one
                    // is better read as "unstated" than propagated into a file.
                    return Number.isFinite(raw) && raw > 0 ? raw : null;
                },
                renderHTML: (attrs: Record<string, unknown>): Record<string, string> => {
                    const height = attrs['height'];

                    return 'number' === typeof height && height > 0
                        ? { 'data-height': String(height) }
                        : {};
                },
            },
        };
    },
});
