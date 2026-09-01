import { Node, mergeAttributes } from '@tiptap/core';

/**
 * The attribute that MEANS "break the page here".
 *
 * Must stay byte-identical to `PageBreakMapper::MARKER_ATTRIBUTE` on the PHP
 * side — that mapper is what turns this into a real DOCX page break, and the
 * two only agree by convention. An attribute rather than a class because a
 * class is also a styling hook: a theme rule, or content pasted from another
 * app, can carry `class="page-break"` with no intent to split anything, and a
 * false break is invisible until someone opens the document.
 */
export const PAGE_BREAK_ATTRIBUTE = 'data-page-break';

/**
 * The node's schema name. Exported because the paged canvas counts sheets by
 * walking the document for it — a second copy of the literal would be
 * a page counter that silently stops counting the day the node is renamed.
 */
export const PAGE_BREAK_NODE_NAME = 'pageBreak';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        pageBreak: {
            /** Insert a page break at the cursor. */
            insertPageBreak: () => ReturnType;
        };
    }
}

/**
 * Explicit page break — an atom block that renders `<hr data-page-break>`.
 *
 * ## Why its own node and not the built-in horizontal rule
 *
 * A horizontal rule is a VISIBLE divider that stays in the flow; this is a
 * layout instruction that produces no ink. Reusing `horizontalRule` would make
 * every decorative rule in every existing document start a new page the next
 * time it was rendered to DOCX — silently, and only discoverable by opening
 * the file. Separate node, separate attribute, no overlap.
 *
 * ## The NodeView is a label, not a rule
 *
 * In the editor the break shows as a dashed line captioned "Page break", so an
 * author can see WHY the following content will start elsewhere. The published
 * HTML carries no such caption — `renderHTML` emits the bare marker.
 */
export const PageBreakNode = Node.create({
    name: PAGE_BREAK_NODE_NAME,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,

    parseHTML() {
        // Any element carrying the marker, matching the PHP mapper which
        // accepts hr / div / p. A high priority so the generic horizontal-rule
        // rule cannot claim a marked <hr> first — the same ordering problem the
        // backend solves by registering PageBreakMapper before the block
        // mappers.
        return [
            { tag: `hr[${PAGE_BREAK_ATTRIBUTE}]`, priority: 100 },
            { tag: `div[${PAGE_BREAK_ATTRIBUTE}]`, priority: 100 },
            { tag: `p[${PAGE_BREAK_ATTRIBUTE}]`, priority: 100 },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        // Empty string, not "true": the PHP side tests for PRESENCE
        // (`hasAttribute`), and an empty value survives every HTML serializer
        // round-trip we go through on the way to storage.
        return ['hr', mergeAttributes(HTMLAttributes, { [PAGE_BREAK_ATTRIBUTE]: '' })];
    },

    addNodeView() {
        return () => {
            const dom = document.createElement('div');
            dom.className = 'cms-page-break';
            dom.setAttribute('contenteditable', 'false');
            dom.setAttribute('title', 'Page break — content after this starts on a new page');

            const label = document.createElement('span');
            label.className = 'cms-page-break__label';
            label.textContent = 'Page break';
            dom.appendChild(label);

            // No `contentDOM`: an atom has no editable interior, and returning
            // one would let a caret land inside a node that cannot hold text.
            return { dom };
        };
    },

    addCommands() {
        return {
            insertPageBreak: () => ({ chain, state }) => {
                // An atom inserted at the very END of the document takes the
                // selection with it, and the next keystroke REPLACES the break
                // instead of starting the new page — the author types, the
                // break vanishes, and nothing says why. Word leaves the caret
                // on the new page; give it somewhere to be. Mid-document there
                // is already a block after the break, so nothing is added and
                // an empty paragraph (a blank line in the .docx) is not
                // invented out of nowhere.
                const atDocEnd = state.selection.to >= state.doc.content.size - 1;

                return chain()
                    .insertContent(atDocEnd
                        ? [{ type: this.name }, { type: 'paragraph' }]
                        : { type: this.name })
                    .run();
            },
        };
    },
});
