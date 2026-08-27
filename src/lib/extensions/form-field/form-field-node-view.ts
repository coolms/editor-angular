import { type Editor } from '@tiptap/core';
import { type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ViewMutationRecord } from '@tiptap/pm/view';
import { resolveFieldType } from './form-field-types';

/**
 * NodeView for the `formField` Tiptap atom node. Renders a chip-style span
 * with type icon + label so authors can spot fields at a glance, and wires
 * a click handler that dispatches `formField.upsert` so the picker reopens
 * with the current attrs pre-populated.
 *
 * Atom + inline means contentDOM is null — ProseMirror will not render any
 * children inside this view, the NodeView owns the visible DOM entirely.
 * Selection is handled the same way MediaNodeView handles it: a class flip
 * on selectNode/deselectNode lets CSS highlight the chip without touching
 * the document.
 */
export class FormFieldNodeView {
    readonly dom: HTMLElement;

    private node: ProseMirrorNode;
    private readonly icon: HTMLElement;
    private readonly labelEl: HTMLElement;
    private readonly typeHintEl: HTMLElement;
    private readonly requiredEl: HTMLElement;

    constructor(
        node: ProseMirrorNode,
        private readonly editor: Editor,
        _getPos: () => number | undefined,
    ) {
        this.node = node;

        this.dom = document.createElement('span');
        this.dom.className = 'cms-form-field';
        this.dom.contentEditable = 'false';
        this.dom.addEventListener('click', (e) => this.onClick(e));

        this.icon = document.createElement('i');
        this.icon.className = 'cms-form-field__icon bi';
        this.dom.appendChild(this.icon);

        this.labelEl = document.createElement('span');
        this.labelEl.className = 'cms-form-field__label';
        this.dom.appendChild(this.labelEl);

        this.typeHintEl = document.createElement('span');
        this.typeHintEl.className = 'cms-form-field__type-hint';
        this.dom.appendChild(this.typeHintEl);

        this.requiredEl = document.createElement('span');
        this.requiredEl.className = 'cms-form-field__required';
        this.requiredEl.textContent = '*';
        this.dom.appendChild(this.requiredEl);

        this.applyAttrs();
    }

    update(node: ProseMirrorNode): boolean {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.applyAttrs();
        return true;
    }

    selectNode(): void {
        this.dom.classList.add('cms-form-field--selected');
    }

    deselectNode(): void {
        this.dom.classList.remove('cms-form-field--selected');
    }

    /** Class-flip mutations from selectNode shouldn't trigger PM reparse. */
    ignoreMutation(mutation: ViewMutationRecord): boolean {
        if (mutation.type !== 'attributes') return false;
        if (mutation.attributeName === 'class') {
            const target = mutation.target as HTMLElement;
            if (target === this.dom) return true;
        }
        return false;
    }

    private applyAttrs(): void {
        const attrs = this.node.attrs as Record<string, unknown>;
        const typeId = String(attrs['type'] ?? 'text');
        const label = String(attrs['label'] ?? '');
        const required = attrs['required'] === true;

        const descriptor = resolveFieldType(typeId);
        // Reset previous icon class then apply current. Keep the base
        // 'cms-form-field__icon bi' tokens intact so the chip layout is
        // stable across type changes.
        this.icon.className = `cms-form-field__icon bi ${descriptor.icon}`;
        this.labelEl.textContent = label === '' ? '(unnamed field)' : label;
        this.typeHintEl.textContent = descriptor.label;

        this.requiredEl.style.display = required ? '' : 'none';
        this.dom.classList.toggle('cms-form-field--required', required);
        this.dom.dataset['type'] = typeId;
    }

    private onClick(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        // Bubble a custom event the host CoolmsEditorComponent listens for;
        // the host re-dispatches `formField.upsert` through EditorActionRegistry
        // with a fully built EditorActionContext (which the NodeView has no
        // direct access to). The detail carries the current attrs so the
        // picker opens in edit mode pre-populated with this field's state.
        this.dom.dispatchEvent(new CustomEvent(FORM_FIELD_EDIT_EVENT, {
            bubbles: true,
            detail: { attrs: { ...this.node.attrs } },
        }));
    }
}

/** Bubbled by FormFieldNodeView on chip click. Listened to by the host. */
export const FORM_FIELD_EDIT_EVENT = 'cms-form-field-edit';

/** Detail payload shape carried on the FORM_FIELD_EDIT_EVENT custom event. */
export interface FormFieldEditEventDetail {
    readonly attrs: Readonly<Record<string, unknown>>;
}
