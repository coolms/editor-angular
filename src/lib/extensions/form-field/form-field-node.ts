import { Node, mergeAttributes, type RawCommands } from '@tiptap/core';
import { FormFieldNodeView } from './form-field-node-view';
import { FORM_FIELD_TYPES } from './form-field-types';

const VALID_TYPE_IDS = new Set<string>(FORM_FIELD_TYPES.map((t) => t.id));

/**
 * Inline atom Tiptap node mirroring a `{widget:formField:fieldId …}` dtmpl
 * tag. Atom because the picker is the sole config UI (no inline editing of
 * label / type / validation), inline so the field can sit mid-paragraph
 * alongside text — the natural placement when authoring documents that
 * mix prose with fillable fields.
 *
 * Storage form is a `<span data-widget="formField" data-field-id=… …>`
 * marker. The parseHTML / renderHTML round-trip is byte-stable for the
 * standard attribute set; the `validation` and `visibility` JSON payloads
 * are base64-encoded so their `{` / `}` braces don't collide with the
 * widget-body regex on the dtmpl side (mirrors the encoding decision in
 * `form-field-transform.ts`).
 *
 * The visual placeholder lives in `FormFieldNodeView` (a chip-style span
 * with icon + label). Click on the chip dispatches `formField.upsert` so
 * the picker reopens with the current attributes pre-populated.
 */

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        formField: {
            upsertFormField: (attrs: Partial<FormFieldAttrs>) => ReturnType;
        };
    }
}

export interface FormFieldAttrs {
    fieldId:      string;
    type:         string;
    label:        string;
    required:     boolean;
    placeholder:  string | null;
    defaultValue: string | null;
    /** Base64-encoded JSON: `FormFieldValidator[]`. Empty string when none. */
    validation:   string;
    /** DataSource shorthand. Empty string when not applicable. */
    datasource:   string;
    /** Base64-encoded JSON: `FormFieldVisibility`. Empty string when none. */
    visibility:   string;
}

export const FormFieldNode = Node.create({
    name: 'formField',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
        return {
            fieldId: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-field-id') ?? '',
                renderHTML: () => ({}),
            },
            type: {
                default: 'text',
                parseHTML: (el: HTMLElement) => {
                    const raw = el.getAttribute('data-type') ?? 'text';
                    return VALID_TYPE_IDS.has(raw) ? raw : 'text';
                },
                renderHTML: () => ({}),
            },
            label: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-label') ?? '',
                renderHTML: () => ({}),
            },
            required: {
                default: false,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-required') === 'true',
                renderHTML: () => ({}),
            },
            placeholder: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-placeholder'),
                renderHTML: () => ({}),
            },
            defaultValue: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-default-value'),
                renderHTML: () => ({}),
            },
            validation: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-validation') ?? '',
                renderHTML: () => ({}),
            },
            datasource: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-datasource') ?? '',
                renderHTML: () => ({}),
            },
            visibility: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-visibility') ?? '',
                renderHTML: () => ({}),
            },
        };
    },

    parseHTML() {
        return [{
            tag: 'span[data-widget="formField"]',
            // Higher than default 50 so a marker span isn't claimed by a
            // generic span rule another extension might register.
            priority: 100,
        }];
    },

    renderHTML({ node, HTMLAttributes }) {
        const attrs = node.attrs as Record<string, unknown>;
        const fieldId = String(attrs['fieldId'] ?? '');
        const type = String(attrs['type'] ?? 'text');
        const label = String(attrs['label'] ?? '');
        const required = attrs['required'] === true;
        const placeholder = attrs['placeholder'] != null ? String(attrs['placeholder']) : null;
        const defaultValue = attrs['defaultValue'] != null ? String(attrs['defaultValue']) : null;
        const validation = String(attrs['validation'] ?? '');
        const datasource = String(attrs['datasource'] ?? '');
        const visibility = String(attrs['visibility'] ?? '');

        const composed: Record<string, string> = {
            'data-widget':   'formField',
            'data-field-id': fieldId,
            'data-type':     type,
            'data-label':    label,
            'data-required': required ? 'true' : 'false',
            class:           required ? 'cms-form-field cms-form-field--required' : 'cms-form-field',
        };
        if (placeholder !== null && placeholder !== '') composed['data-placeholder'] = placeholder;
        if (defaultValue !== null && defaultValue !== '') composed['data-default-value'] = defaultValue;
        if (validation !== '') composed['data-validation'] = validation;
        if (datasource !== '') composed['data-datasource'] = datasource;
        if (visibility !== '') composed['data-visibility'] = visibility;

        // Empty content list — atom node has no children. The visible chip
        // is composed by the NodeView.
        return ['span', mergeAttributes(HTMLAttributes, composed)];
    },

    addCommands() {
        return {
            upsertFormField: (attrs: Partial<FormFieldAttrs>) => ({ chain, state }) => {
                // When the active selection is already on a formField node,
                // patch its attrs in place; otherwise insert a new node at the
                // current cursor position.
                const isActive = state.selection.$from.parent.type.name === 'formField'
                    || (state.selection as { node?: { type?: { name?: string } } }).node?.type?.name === 'formField';
                if (isActive) {
                    return chain().updateAttributes('formField', attrs).run();
                }
                return chain().insertContent({ type: 'formField', attrs }).run();
            },
        };
    },

    addNodeView() {
        return ({ node, editor, getPos }) =>
            new FormFieldNodeView(node, editor, getPos);
    },
});
