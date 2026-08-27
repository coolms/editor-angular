import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * Character-level font family, size and colour (#2062).
 *
 * ## Why one local mark instead of Tiptap's official extensions
 *
 * The equivalent off the shelf is three packages — `extension-text-style`,
 * `extension-color`, `extension-font-family` — and they still would not cover
 * SIZE, for which Tiptap ships nothing at all. So a custom mark was needed
 * either way; making it carry all three keeps one thing to reason about instead
 * of four, and adds no dependency to align with the Tiptap major on every
 * upgrade.
 *
 * ## Why it is always on, never profile-gated
 *
 * An unregistered mark is not inert — ProseMirror STRIPS what it cannot model.
 * A document with fonts opened under a profile that omitted this would come
 * back with the spans silently removed and save that way, which is data loss
 * disguised as a narrower toolbar. The toolbar CONTROLS are gated instead: a
 * profile can decline to offer fonts without destroying documents that have
 * them.
 *
 * ## The rendered shape is the contract
 *
 * `<span style="font-family: …; font-size: …pt; color: …">` — which is exactly
 * what `TextMapper::inlineStyle()` reads on the way into a .docx. The two are
 * one feature seen from two ends: change the markup here and the .docx stops
 * carrying the font, with nothing failing in between.
 */
export interface TextStyleAttributes {
    fontFamily: string | null;
    /** POINTS. Stored unitless; the `pt` suffix is added when rendering. */
    fontSize: number | null;
    /** `#RRGGBB`. */
    color: string | null;
    /** Highlight behind the text, `#RRGGBB`. Null means NO fill, not white. */
    background: string | null;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        coolmsTextStyle: {
            setCoolmsTextStyle: (attrs: Partial<TextStyleAttributes>) => ReturnType;
            unsetCoolmsTextStyle: () => ReturnType;
        };
    }
}

export const CoolmsTextStyle = Mark.create({
    name: 'coolmsTextStyle',

    // Fonts do not survive a paragraph break as a "current style" — each run
    // carries its own, exactly as a .docx run does.
    keepOnSplit: false,

    addAttributes() {
        return {
            fontFamily: {
                default: null,
                parseHTML: (el: HTMLElement) => el.style.fontFamily?.replace(/["']/g, '') || null,
                // Rendered together below, so each attribute contributes
                // nothing on its own — three separate `style` keys would be
                // merged by concatenation and produce a malformed attribute.
                renderHTML: () => ({}),
            },
            fontSize: {
                default: null,
                parseHTML: (el: HTMLElement) => {
                    const raw = el.style.fontSize;
                    if (!raw) return null;
                    const value = Number.parseFloat(raw);
                    if (!Number.isFinite(value) || value <= 0) return null;

                    // The canvas paints in px; the model and the .docx speak
                    // points. Converting on the way IN means a document that
                    // round-trips through a browser keeps the size the author
                    // chose rather than drifting by a third each time.
                    return raw.endsWith('px') ? Math.round(value * 72 / 96 * 100) / 100 : value;
                },
                renderHTML: () => ({}),
            },
            color: {
                default: null,
                parseHTML: (el: HTMLElement) => el.style.color || null,
                renderHTML: () => ({}),
            },
            background: {
                default: null,
                parseHTML: (el: HTMLElement) => el.style.backgroundColor || null,
                renderHTML: () => ({}),
            },
        };
    },

    parseHTML() {
        return [{
            tag: 'span',
            // Only spans that actually carry one of ours. Claiming every span
            // would make this mark swallow widget and decoration markup that
            // other extensions own.
            getAttrs: (el: HTMLElement | string) => {
                if (typeof el === 'string') return false;
                const s = el.style;

                // ⚠️ `backgroundColor` belongs in this list, and was missing
                // (#2289). The mark MODELS a background — `renderHTML` writes
                // one — so a span carrying only a highlight matched nothing,
                // and ProseMirror strips what nothing claims: a run highlighted
                // and not otherwise styled lost its highlight on load and saved
                // without it. Every property this mark can write, it must also
                // recognise.
                return (s.fontFamily || s.fontSize || s.color || s.backgroundColor) ? {} : false;
            },
        }];
    },

    renderHTML({ HTMLAttributes, mark }) {
        const attrs = mark.attrs as TextStyleAttributes;
        const style = [
            attrs.fontFamily ? `font-family: ${attrs.fontFamily}` : '',
            attrs.fontSize ? `font-size: ${attrs.fontSize}pt` : '',
            attrs.color ? `color: ${attrs.color}` : '',
            attrs.background ? `background-color: ${attrs.background}` : '',
        ].filter(Boolean).join('; ');

        // No style left means the mark has nothing to say. Rendering a bare
        // span would leave an empty wrapper in the saved source that grows on
        // every edit and reads as noise in a diff.
        if ('' === style) {
            return ['span', mergeAttributes(HTMLAttributes), 0];
        }

        return ['span', mergeAttributes(HTMLAttributes, { style }), 0];
    },

    addCommands() {
        return {
            // MERGES with whatever the selection already carries, so setting a
            // size does not clear the family — the toolbar sets one property at
            // a time and each would otherwise wipe the others.
            setCoolmsTextStyle: (attrs) => ({ chain, editor }) => {
                const current = editor.getAttributes(this.name) as Partial<TextStyleAttributes>;
                const next = { ...current, ...attrs };

                const empty = null === next.fontFamily
                    && null === next.fontSize
                    && null === next.color
                    && null === next.background;

                return empty
                    ? chain().unsetMark(this.name).run()
                    : chain().setMark(this.name, next).run();
            },
            unsetCoolmsTextStyle: () => ({ chain }) => chain().unsetMark(this.name).run(),
        };
    },
});
