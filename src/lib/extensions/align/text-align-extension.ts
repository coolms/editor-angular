import { Extension } from '@tiptap/core';

/** The alignments a document can hold — the model's own four (`w:jc`). */
export type CmsTextAlign = 'left' | 'center' | 'right' | 'justify';

const ALIGNMENTS: readonly CmsTextAlign[] = ['left', 'center', 'right', 'justify'];

/** The node types an alignment may sit on. */
const ALIGNABLE = ['paragraph', 'heading'];

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        cmsTextAlign: {
            /** Align the paragraphs in the selection, or clear the alignment. */
            setCmsTextAlign: (align: CmsTextAlign | null) => ReturnType;
        };
    }
}

/**
 * Paragraph alignment, as a global attribute on paragraphs and headings.
 *
 * ## Why written here rather than pulled in
 *
 * `@tiptap/extension-text-align` is not installed in the line we use, and the
 * whole of what it does is the attribute below plus a command. Same reasoning
 * as `script-marks.ts`, which writes its own superscript rather than adding a
 * package for a schema declaration.
 *
 * ## ⚠️ Absent is not `left`
 *
 * The default is null and an unset alignment renders NOTHING. A paragraph with
 * no alignment inherits — from its style, and failing that from the document's
 * direction, which is right-aligned in a right-to-left document. Emitting
 * `text-align: left` for the unset case would pin every paragraph of every
 * imported document to one edge. `ParagraphAlignment` on the PHP side draws the
 * same distinction and for the same reason.
 *
 * ## Loaded only where a document is being edited
 *
 * Behind the editor's `preserveDocumentFormatting` input, like the other units
 * a stored document needs: `HtmlProfileSanitizer` strips `style` from page
 * content, so an editor that kept an alignment there would show an author
 * something the server then discards.
 */
export const CmsTextAlignExtension = Extension.create({
    name: 'cmsTextAlign',

    addGlobalAttributes() {
        return [{
            types: ALIGNABLE,
            attributes: {
                align: {
                    default: null as CmsTextAlign | null,
                    parseHTML: (element: HTMLElement): CmsTextAlign | null => {
                        const raw = element.style.textAlign as CmsTextAlign;

                        return ALIGNMENTS.includes(raw) ? raw : null;
                    },
                    renderHTML: (attrs: Record<string, unknown>): Record<string, string> => {
                        const align = attrs['align'];

                        return 'string' === typeof align && ALIGNMENTS.includes(align as CmsTextAlign)
                            ? { style: `text-align: ${align}` }
                            : {};
                    },
                },
            },
        }];
    },

    addCommands() {
        return {
            setCmsTextAlign: (align: CmsTextAlign | null) => ({ commands, editor }) => {
                // Toggling: pressing the button an aligned paragraph already
                // carries CLEARS it, so an author can get back to "inherits"
                // without knowing that is what it is called. Word's ribbon
                // behaves the same way.
                const next = ALIGNABLE.some(type => editor.getAttributes(type)['align'] === align)
                    ? null
                    : align;

                return ALIGNABLE
                    .map(type => commands.updateAttributes(type, { align: next }))
                    .some(Boolean);
            },
        };
    },
});
