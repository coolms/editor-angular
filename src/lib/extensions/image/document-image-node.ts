import Image from '@tiptap/extension-image';

/**
 * A plain `<img>` with the size a document states.
 *
 * ## Why the editor had no image node at all
 *
 * Page content does not use one: a picture on a page is a `mediaWidget` chip
 * that resolves to a media-library reference at render time, which is what
 * gives it a stable identity, a caption and a right to exist after the file
 * moves. A raw `<img>` had no place in that world, so nothing modelled one —
 * and ProseMirror STRIPS what it cannot model.
 *
 * A document is the world where a raw `<img>` is the only honest answer. An
 * image imported from somebody else's `.docx` has no media-library entry and no
 * address: `DocumentHtmlWriter` hands it over as a `data:` URI, and without
 * this node the picture disappears the first time the author saves.
 *
 * ##  Loaded only where a document is being edited
 *
 * Gated behind the editor's `preserveDocumentFormatting` input rather than
 * always on. On the page path an `<img>` that survived the editor would still
 * be removed by `HtmlProfileSanitizer` on save, so the two surfaces would show
 * an author different things and only one of them would be true.
 *
 * ## Width and height are POINTS, not pixels
 *
 * The mapper reads `width` / `height` as points, which is a drift from CSS that
 * predates this node and is preserved on purpose — see `docs/formats/ddoc.md`.
 * Stock `@tiptap/extension-image` models neither attribute, so both are
 * declared here or a resized picture comes back at its intrinsic size.
 */
export const DocumentImageNode = Image.extend({
    name: 'image',

    addAttributes() {
        return {
            ...this.parent?.(),
            width: {
                default: null as number | null,
                parseHTML: (element: HTMLElement): number | null => {
                    const raw = Number.parseFloat(element.getAttribute('width') ?? '');

                    return Number.isFinite(raw) && raw > 0 ? raw : null;
                },
                renderHTML: (attrs: Record<string, unknown>): Record<string, string> => {
                    const value = attrs['width'];

                    return 'number' === typeof value ? { width: String(value) } : {};
                },
            },
            height: {
                default: null as number | null,
                parseHTML: (element: HTMLElement): number | null => {
                    const raw = Number.parseFloat(element.getAttribute('height') ?? '');

                    return Number.isFinite(raw) && raw > 0 ? raw : null;
                },
                renderHTML: (attrs: Record<string, unknown>): Record<string, string> => {
                    const value = attrs['height'];

                    return 'number' === typeof value ? { height: String(value) } : {};
                },
            },
        };
    },
}).configure({
    // A `data:` URI is the whole point here: an image with no address of its
    // own has nowhere else to live. `HtmlProfileSanitizer` never sees document
    // content, and the bytes came out of the document the author already has.
    allowBase64: true,
    inline: true,
});
