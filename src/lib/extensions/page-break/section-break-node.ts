import { SECTION_BREAK_ATTRIBUTE, SECTION_BREAK_HTML, SECTION_BREAK_PATTERN } from '@coolms/ddoc';
import { Node, mergeAttributes } from '@tiptap/core';

/*
 * The section-break markup -- the attribute, what a joined document puts between two sections, and the pattern it
 * splits on -- is @coolms/ddoc's (2026-10-07): one copy for every client of the `.ddoc` format, tested where it is
 * published. Re-exported, so an import from @coolms/editor-angular keeps working.
 */
export { SECTION_BREAK_ATTRIBUTE, SECTION_BREAK_HTML, SECTION_BREAK_PATTERN };

export const SECTION_BREAK_NODE_NAME = 'sectionBreak';

/**
 * A section break -- where one page setup ends and the next begins.
 *
 * ## Why the editor needs one at all
 *
 * A `.ddoc` is a LIST of sections, each with its own paper, headers and
 * footers. The editor holds one flow of content. Showing only the first
 * section would leave the rest of the document invisible while still saving it
 * -- an author would see a document shorter than the one they have -- so the
 * sections are joined for editing with this atom between them and split apart
 * again on save.
 *
 *  Not the same thing as a PAGE break, and the distinction is the reason
 * this is a separate node rather than an attribute on that one. A page break
 * starts a new page in the SAME section, under the same paper and the same
 * headers. A section break is where those can change.
 *
 * ## Deleting one merges two sections, and that is Word's behaviour too
 *
 * The section that ended here stops existing, and its headers and footers go
 * with it -- `DdocEditorProjection` matches sections by position, so a document
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
        // needed -- the two attributes are different -- but the generic
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
