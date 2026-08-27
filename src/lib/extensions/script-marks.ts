import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * Minimal `superscript` / `subscript` TipTap marks.
 *
 * Written inline rather than pulling `@tiptap/extension-superscript` /
 * `-subscript` (not published in the v3 line we use, and absent from the
 * consolidated `@tiptap/extensions` package). They are trivial `<sup>`/`<sub>`
 * marks — schema only; toggling is driven by the generic `tiptap.toggleMark`
 * action handler, so no custom commands are needed.
 *
 * Each excludes the other so the same run can't be both super- and subscript
 * (typographically meaningless).
 */
export const SuperscriptMark = Mark.create({
    name: 'superscript',
    excludes: 'subscript',

    parseHTML() {
        return [
            { tag: 'sup' },
            {
                style: 'vertical-align',
                getAttrs: (value) => (value === 'super' ? {} : false),
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ['sup', mergeAttributes(HTMLAttributes), 0];
    },
});

export const SubscriptMark = Mark.create({
    name: 'subscript',
    excludes: 'superscript',

    parseHTML() {
        return [
            { tag: 'sub' },
            {
                style: 'vertical-align',
                getAttrs: (value) => (value === 'sub' ? {} : false),
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ['sub', mergeAttributes(HTMLAttributes), 0];
    },
});
