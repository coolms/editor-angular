import { Node, mergeAttributes } from '@tiptap/core';

/** The attribute that means "a new section starts after this". */
export const SECTION_BREAK_ATTRIBUTE = 'data-section-break';

export const SECTION_BREAK_NODE_NAME = 'sectionBreak';

/** What a joined document puts between two sections, and splits on again. */
export const SECTION_BREAK_HTML = `<hr ${SECTION_BREAK_ATTRIBUTE}>`;

/**
 * Matches the break however the serializer chose to write its empty value.
 *
 * ⚠️ Deliberately NOT global. `String.split()` ignores the `g` flag but a
 * shared global regex carries `lastIndex` between calls, and every other use of
 * one here would start from wherever the previous call left off.
 */
export const SECTION_BREAK_PATTERN = new RegExp(`<hr[^>]*${SECTION_BREAK_ATTRIBUTE}[^>]*>`);

/**
 * A section break — where one page setup ends and the next begins.
 *
 * ## Why the editor needs one at all
 *
 * A `.ddoc` is a LIST of sections, each with its own paper, headers and
 * footers. The editor holds one flow of content. Showing only the first
 * section would leave the rest of the document invisible while still saving it
 * — an author would see a document shorter than the one they have — so the
 * sections are joined for editing with this atom between them and split apart
 * again on save.
 *
 * ⚠️ Not the same thing as a PAGE break, and the distinction is the reason
 * this is a separate node rather than an attribute on that one. A page break
 * starts a new page in the SAME section, under the same paper and the same
 * headers. A section break is where those can change.
 *
 * ## Deleting one merges two sections, and that is Word's behaviour too
 *
 * The section that ended here stops existing, and its headers and footers go
 * with it — `DdocEditorProjection` matches sections by position, so a document
 * that comes back with fewer of them has lost the trailing ones deliberately.
 * That is what Word does when you delete a section break, and the label below
 * says what the mark is so nobody deletes one thinking it is a rule.
 */
export const SectionBreakNode = Node.create({
    name: SECTION_BREAK_NODE_NAME,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,

    parseHTML() {
        // Priority over the page break's own `hr[data-page-break]` rule is not
        // needed — the two attributes are different — but the generic
        // horizontal rule would claim a bare `<hr>`, so this stays explicit.
        return [{ tag: `hr[${SECTION_BREAK_ATTRIBUTE}]`, priority: 100 }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['hr', mergeAttributes(HTMLAttributes, { [SECTION_BREAK_ATTRIBUTE]: '' })];
    },

    addNodeView() {
        return () => {
            const dom = document.createElement('div');
            dom.className = 'cms-section-break';
            dom.setAttribute('contenteditable', 'false');
            dom.setAttribute(
                'title',
                'Section break — the page setup, headers and footers can change here',
            );

            const label = document.createElement('span');
            label.className = 'cms-section-break__label';
            label.textContent = 'Section break';
            dom.appendChild(label);

            return { dom };
        };
    },
});
