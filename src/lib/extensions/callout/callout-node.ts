import { Node, mergeAttributes } from '@tiptap/core';
import type { EditorTranslate } from '../../editor.types';
import { CalloutNodeView } from './callout-node-view';

/** Callout kinds the editor + theme both understand. */
export const CALLOUT_TYPES = ['note', 'warning', 'tip'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

const DEFAULT_CALLOUT_TYPE: CalloutType = 'note';

export function normalizeType(value: unknown): CalloutType {
    return CALLOUT_TYPES.includes(value as CalloutType)
        ? (value as CalloutType)
        : DEFAULT_CALLOUT_TYPE;
}

/**
 * Toolbar i18n key per kind — REUSED as the box's title label so the in-editor
 * title and the published-page title (rendered server-side by the PHP
 * `CalloutTitleProcessor` from the SAME keys) stay in lockstep.
 */
export const CALLOUT_LABEL_KEYS: Record<CalloutType, string> = {
    note:    'editor.toolbar.block.calloutNote',
    warning: 'editor.toolbar.block.calloutWarning',
    tip:     'editor.toolbar.block.calloutTip',
};

/**
 * English fallbacks for the NodeView title when no `EDITOR_TRANSLATE` provider
 * is wired (the default today). Mirrors the backend `FALLBACK_LABELS` and the
 * editor component's `BUILTIN_LABEL_FALLBACKS` so every surface agrees.
 */
export const DEFAULT_CALLOUT_LABELS: Record<CalloutType, string> = {
    note: 'Note',
    warning: 'Warning',
    tip: 'Tip',
};

/**
 * Inline Bootstrap-Icons SVG per kind (info-circle · exclamation-triangle ·
 * lightbulb). Kept byte-identical to the backend `CalloutTitleProcessor::ICONS`
 * so the editor and the published page show the same glyph — and so the public
 * theme (which ships no icon font) can embed the icon inline.
 */
export const CALLOUT_ICONS: Record<CalloutType, string> = {
    note:    '<svg class="callout__icon" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/></svg>',
    warning: '<svg class="callout__icon" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M7.938 2.016A.13.13 0 0 1 8.002 2a.13.13 0 0 1 .063.016.15.15 0 0 1 .054.057l6.857 11.667c.036.06.035.124.002.183a.2.2 0 0 1-.054.06.1.1 0 0 1-.066.017H1.146a.1.1 0 0 1-.066-.017.2.2 0 0 1-.054-.06.18.18 0 0 1 .002-.183L7.884 2.073a.15.15 0 0 1 .054-.057m1.044-.45a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767z"/><path d="M7.002 12a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7.1 5.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z"/></svg>',
    tip:     '<svg class="callout__icon" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13a.5.5 0 0 1 0 1 .5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1 0-1 .5.5 0 0 1 0-1 .5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6m6-5a5 5 0 0 0-3.479 8.592c.263.254.514.564.676.941L5.83 12h4.342l.632-1.467c.162-.377.413-.687.676-.941A5 5 0 0 0 8 1"/></svg>',
};

/** Per-extension options. Carries the host's label translator for the NodeView. */
export interface CalloutOptions {
    /**
     * Resolves a toolbar i18n key to a localized label for the in-editor title.
     * Null when the host wires no `EDITOR_TRANSLATE` provider — the NodeView
     * then falls back to {@link DEFAULT_CALLOUT_LABELS}. Captured at boot by
     * `provideCoolmsEditor()` and passed via `CalloutNode.configure({ translate })`.
     */
    translate: EditorTranslate | null;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        callout: {
            /**
             * Switch the kind of the callout the selection is inside, in place.
             * No-op (returns false) when the cursor isn't within a callout. The
             * `type` attribute is the single source of truth; the NodeView's
             * `update()` re-renders the class + title from it.
             */
            setCalloutType: (type: CalloutType) => ReturnType;
        };
    }
}

/**
 * Callout / admonition block — a boxed aside (note · warning · tip) holding any
 * block content. Saved HTML shape (box only — the title is render-time):
 *
 *     <div class="callout callout-note" data-callout="note">
 *       <p>…</p>
 *     </div>
 *
 * The `class` carries the kind for the public theme's CSS; `data-callout`
 * round-trips the kind back into the editor on load. One node serves all three
 * kinds (the `type` attribute distinguishes them), inserted by the three
 * `callout:*` toolbar buttons via `callout.insert`.
 *
 * A NodeView ({@see CalloutNodeView}) renders a localized, iconed title line +
 * an in-place type switcher while editing — but `renderHTML()` below still emits
 * the bare box, so `getHTML()` stays clean: the title is never stored (the
 * public theme re-adds its own localized title at render time via
 * `CalloutTitleProcessor`, so there's nothing to double-inject on the next load).
 */
export const CalloutNode = Node.create<CalloutOptions>({
    name: 'callout',
    group: 'block',
    content: 'block+',
    defining: true,

    addOptions(): CalloutOptions {
        return { translate: null };
    },

    addAttributes() {
        return {
            type: {
                default: DEFAULT_CALLOUT_TYPE,
                parseHTML: (element) => normalizeType(element.getAttribute('data-callout')),
                renderHTML: (attributes) => {
                    const type = normalizeType(attributes['type']);
                    return { 'data-callout': type, class: `callout callout-${type}` };
                },
            },
        };
    },

    parseHTML() {
        return [{ tag: 'div.callout' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes), 0];
    },

    addCommands() {
        return {
            setCalloutType: (type: CalloutType) => ({ state, dispatch }) => {
                const normalized = normalizeType(type);
                const { $from } = state.selection;
                for (let depth = $from.depth; depth > 0; depth--) {
                    const node = $from.node(depth);
                    if (node.type.name === this.name) {
                        if (dispatch) {
                            const pos = $from.before(depth);
                            dispatch(state.tr.setNodeMarkup(pos, undefined, {
                                ...node.attrs,
                                type: normalized,
                            }));
                        }
                        return true;
                    }
                }
                return false;
            },
        };
    },

    addNodeView() {
        const translate = this.options.translate;
        return ({ node, editor, getPos }) =>
            new CalloutNodeView(node, editor, getPos, translate);
    },
});
