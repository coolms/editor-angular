import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * The attribute that MEANS "this superscript is a footnote reference".
 *
 * Must stay byte-identical to `FootnoteMapper::MARKER_ATTRIBUTE` on the PHP
 * side — that mapper is what turns this into a real OOXML
 * `w:footnoteReference`, and the two only agree by convention.
 */
export const FOOTNOTE_ATTRIBUTE = 'data-footnote';

export const FOOTNOTE_REFERENCE_NODE_NAME = 'footnoteReference';

/**
 * Every note id the document points at, in document order, without duplicates.
 *
 * The panel needs it to say which notes are live and which are orphans, and the
 * insert handler needs it to allocate. Mirrors `FootnoteReferences::inOrder()`
 * on the PHP side — the same walk, over the other representation.
 */
export function footnoteIdsInDocument(doc: ProseMirrorNode): number[] {
    const ids: number[] = [];

    doc.descendants((node) => {
        if (FOOTNOTE_REFERENCE_NODE_NAME !== node.type.name) return true;

        const id = node.attrs['id'];
        if ('number' === typeof id && id >= 1 && !ids.includes(id)) {
            ids.push(id);
        }

        // An atom has nothing inside it worth walking.
        return false;
    });

    return ids;
}

/**
 * The next id free by construction: one more than the highest the document
 * already points at.
 *
 *  Not "count + 1". Deleting the second of three references would make that
 * hand out 3 again, and the new marker would land on a note that is still
 * there — the seam keeps a body whose reference has gone.
 */
export function nextFootnoteId(doc: ProseMirrorNode): number {
    return footnoteIdsInDocument(doc).reduce((highest, id) => Math.max(highest, id), 0) + 1;
}

/**
 * A footnote reference — an inline atom rendering `<sup data-footnote="3">3</sup>`.
 *
 * ## Why a node exists at all when nothing inserts one
 *
 * ProseMirror does not ignore what it cannot model, it STRIPS it. A `.ddoc`
 * carries footnotes, `DocumentHtmlWriter` puts their references in the body as
 * `<sup data-footnote="N">`, and without this node every one of them would be
 * gone the first time an author saved — silently, and with the note bodies left
 * behind pointing at nothing. The same reasoning that keeps `CoolmsTextStyle`
 * always on: an unregistered thing is not inert.
 *
 *  **It must out-rank the superscript MARK.** `SuperscriptMark` claims a bare
 * `<sup>`, so without the priority below a reference would parse as ordinary
 * superscript text: the digit stays, the attribute goes, and the document looks
 * right while the footnote is dead. That is worse than losing it outright,
 * because nothing about the page says anything is wrong.
 *
 * ## The number on screen is NOT this id
 *
 * The id is a KEY. Every reader — Word, LibreOffice, us — prints a footnote's
 * POSITION, so a document whose ids are not in document order says 7 where the
 * page says 1. Measured, where it was worse than cosmetic: LibreOffice
 * pairs the two `.docx` parts by position, and the writer now renumbers on the
 * way out for that reason.
 *
 * `renderHTML` still writes the id as the element's text, because that is what
 * `DocumentHtmlWriter` emits and a round trip should not quietly change shape.
 * The CANVAS covers it with a CSS counter, which is always right and costs no
 * JavaScript — see `.cms-footnote` in `editor.component.ts`.
 */
export const FootnoteReferenceNode = Node.create({
    name: FOOTNOTE_REFERENCE_NODE_NAME,
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
        return {
            id: {
                default: null as number | null,
                parseHTML: (element: HTMLElement): number | null => {
                    const raw = Number.parseInt(element.getAttribute(FOOTNOTE_ATTRIBUTE) ?? '', 10);

                    //  1 or more. OOXML reserves -1 and 0 for the two
                    // separator notes every package carrying footnotes must
                    // have, so a reference to either points at a horizontal
                    // rule instead of a note.
                    return Number.isInteger(raw) && raw >= 1 ? raw : null;
                },
                renderHTML: (attrs: Record<string, unknown>): Record<string, string> => {
                    const id = attrs['id'];

                    return 'number' === typeof id && id >= 1
                        ? { [FOOTNOTE_ATTRIBUTE]: String(id) }
                        : {};
                },
            },
        };
    },

    parseHTML() {
        // Priority over the superscript mark's bare `sup` rule — see above.
        return [{ tag: `sup[${FOOTNOTE_ATTRIBUTE}]`, priority: 100 }];
    },

    renderHTML({ node, HTMLAttributes }) {
        const id = node.attrs['id'];

        // The number is the visible text as well as the attribute: an author
        // reading the document sees the same marker Word would print, and the
        // PHP mapper reads the attribute rather than the text, so the two
        // cannot drift into disagreeing about which note this is.
        return ['sup', mergeAttributes(HTMLAttributes), 'number' === typeof id ? String(id) : ''];
    },
});
