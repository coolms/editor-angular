import HardBreak from '@tiptap/extension-hard-break';

import { PAGE_BREAK_ATTRIBUTE } from './page-break-node';

/**
 * Shift+Enter's `<br>`, plus the one thing a `.docx` can put in the same place:
 * a page break INSIDE a paragraph.
 *
 * ## Why the block-level page break is not enough
 *
 * OOXML puts a break in a RUN, so a paragraph may be split by one — the
 * ordinary shape in an imported document, where a break lands mid-sentence.
 * `PageBreakNode` is a block atom and cannot express that: closing the
 * paragraph to emit one would add a paragraph mark the author never typed.
 * `DocumentHtmlWriter` therefore writes `<br data-page-break>` for it, and
 * `PageBreakMapper` reads the marker on a `<br>` as the same instruction.
 *
 * ⚠️ Without the attribute below, ProseMirror keeps the `<br>` and STRIPS the
 * marker — so the page break silently becomes a line break, the following text
 * stays on the same page, and nothing says why the document got shorter.
 *
 * ## Inert everywhere else
 *
 * The attribute defaults to false and renders nothing when unset, so an
 * ordinary soft line break in page content is byte-identical to what it was.
 */
export const CmsHardBreak = HardBreak.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            pageBreak: {
                default: false,
                parseHTML: (element: HTMLElement): boolean => element.hasAttribute(PAGE_BREAK_ATTRIBUTE),
                renderHTML: (attrs: Record<string, unknown>): Record<string, string> =>
                    // Empty string, not "true": the PHP mapper tests for
                    // PRESENCE, and an empty value survives every serializer
                    // this content passes through on the way to storage.
                    (true === attrs['pageBreak'] ? { [PAGE_BREAK_ATTRIBUTE]: '' } : {}),
            },
        };
    },
});
