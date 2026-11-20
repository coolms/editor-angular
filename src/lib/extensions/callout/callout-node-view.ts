import { type Editor } from '@tiptap/core';
import { type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ViewMutationRecord } from '@tiptap/pm/view';
import type { EditorTranslate } from '../../editor.types';
import {
    CALLOUT_ICONS,
    CALLOUT_LABEL_KEYS,
    CALLOUT_TYPES,
    type CalloutType,
    DEFAULT_CALLOUT_LABELS,
    normalizeType,
} from './callout-node';

const SWITCHER_ARIA_KEY = 'editor.toolbar.block.calloutType';
const SWITCHER_ARIA_FALLBACK = 'Callout type';

/**
 * ProseMirror NodeView for the `callout` Tiptap node. Renders the editable
 * content in a `<div class="callout__body">` (the contentDOM) under a
 * non-editable title line that carries:
 *
 *   - an inline SVG icon + a localized label ("Note" / "Warning" / "Tip"),
 *     resolved through the host `translate` (EDITOR_TRANSLATE) with an English
 *     fallback — parity with the published page, which the PHP
 *     `CalloutTitleProcessor` titles from the same i18n keys; and
 *   - a top-right `<select>` type switcher that changes the callout's `type`
 *     attribute in place (no delete + re-insert). The `type` attr is the single
 *     source of truth — `update()` re-derives the class, icon, label, and select
 *     value from it whenever it changes.
 *
 * Mirrors the `GridColumnNodeView` pattern: `dom` holds a non-content decoration
 * (here the title) plus the `contentDOM`; `stopEvent` keeps ProseMirror's
 * selection logic off the title controls; `ignoreMutation` stops PM re-parsing
 * the decoration. `renderHTML()` on the node still emits the bare box, so
 * `getHTML()` (and the stored content) never contains the title or switcher.
 */
export class CalloutNodeView {
    readonly dom: HTMLElement;
    readonly contentDOM: HTMLElement;

    private node: ProseMirrorNode;
    private readonly iconEl: HTMLElement;
    private readonly labelEl: HTMLElement;
    private readonly titleEl: HTMLElement;
    private readonly select: HTMLSelectElement;

    constructor(
        node: ProseMirrorNode,
        private readonly editor: Editor,
        private readonly getPos: () => number | undefined,
        private readonly translate: EditorTranslate | null,
    ) {
        this.node = node;

        this.dom = document.createElement('div');

        // -- Title line (decoration — not part of the content hole) ----------
        this.titleEl = document.createElement('div');
        this.titleEl.className = 'callout__title';
        this.titleEl.contentEditable = 'false';

        this.iconEl = document.createElement('span');
        this.iconEl.className = 'callout__icon-holder';
        this.titleEl.appendChild(this.iconEl);

        this.labelEl = document.createElement('span');
        this.labelEl.className = 'callout__label';
        this.titleEl.appendChild(this.labelEl);

        this.select = document.createElement('select');
        this.select.className = 'callout__switcher';
        this.select.setAttribute('aria-label', this.resolve(SWITCHER_ARIA_KEY, SWITCHER_ARIA_FALLBACK));
        for (const kind of CALLOUT_TYPES) {
            const option = document.createElement('option');
            option.value = kind;
            option.textContent = this.labelOf(kind);
            this.select.appendChild(option);
        }
        this.select.addEventListener('change', () => this.onSwitch());
        this.titleEl.appendChild(this.select);

        this.dom.appendChild(this.titleEl);

        // -- Body (the editable content hole) --------------------------------
        this.contentDOM = document.createElement('div');
        this.contentDOM.className = 'callout__body';
        this.dom.appendChild(this.contentDOM);

        this.applyType(this.currentType());
    }

    /** ProseMirror calls this whenever the node's attrs change (e.g. type switch). */
    update(node: ProseMirrorNode): boolean {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.applyType(this.currentType());
        return true;
    }

    /** Let the title's own controls (the type <select>) handle their events. */
    stopEvent(event: Event): boolean {
        return this.titleEl.contains(event.target as Node | null);
    }

    /** Decoration mutations (icon swap, select value) must not trigger a reparse. */
    ignoreMutation(mutation: ViewMutationRecord): boolean {
        if (mutation.type === 'selection') return false;
        return !this.contentDOM.contains(mutation.target);
    }

    private currentType(): CalloutType {
        return normalizeType((this.node.attrs as Record<string, unknown>)['type']);
    }

    private applyType(type: CalloutType): void {
        this.dom.className = `callout callout-${type}`;
        this.dom.setAttribute('data-callout', type);
        this.iconEl.innerHTML = CALLOUT_ICONS[type];
        this.labelEl.textContent = this.labelOf(type);
        if (this.select.value !== type) this.select.value = type;
    }

    private labelOf(type: CalloutType): string {
        return this.resolve(CALLOUT_LABEL_KEYS[type], DEFAULT_CALLOUT_LABELS[type]);
    }

    /** Resolve an i18n key via the host translator, falling back to plain text. */
    private resolve(key: string, fallback: string): string {
        if (this.translate) {
            const resolved = this.translate(key);
            if (resolved && resolved !== key) return resolved;
        }
        return fallback;
    }

    private onSwitch(): void {
        const next = normalizeType(this.select.value);
        const pos = this.getPos();
        if (pos === undefined) return;
        // Drive the attribute through a single transaction so undo treats the
        // kind change as one step; update() then re-renders from the new attr.
        this.editor.chain().focus().command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, type: next });
            return true;
        }).run();
    }
}
