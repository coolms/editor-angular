/**
 * Catalogue of form field types the picker offers, mirroring the type set
 * the backend FormConfigRenderBuilder.resolveFieldType maps Symfony type
 * aliases onto. Centralised so the picker grid, the Tiptap node default
 * attribute, and the icon mapping all draw from one source.
 *
 * When the Form module exposes a FieldType registry over HTTP (deferred to
 * F.5+), this module-local list becomes a default fallback consulted only
 * when the API hasn't been called yet.
 */

export type FormFieldType =
    | 'text'
    | 'email'
    | 'password'
    | 'number'
    | 'textarea'
    | 'select'
    | 'toggle'
    | 'date'
    | 'time'
    | 'datetime'
    | 'hidden';

export interface FormFieldTypeDescriptor {
    readonly id:    FormFieldType;
    readonly label: string;
    readonly icon:  string;
    /** True when the type binds to a DataSource (select / future relation). */
    readonly needsDataSource: boolean;
}

export const FORM_FIELD_TYPES: ReadonlyArray<FormFieldTypeDescriptor> = [
    { id: 'text',     label: 'Text',          icon: 'bi-input-cursor-text', needsDataSource: false },
    { id: 'email',    label: 'Email',         icon: 'bi-envelope',          needsDataSource: false },
    { id: 'password', label: 'Password',      icon: 'bi-key',               needsDataSource: false },
    { id: 'number',   label: 'Number',        icon: 'bi-123',               needsDataSource: false },
    { id: 'textarea', label: 'Long text',     icon: 'bi-textarea-resize',   needsDataSource: false },
    { id: 'select',   label: 'Dropdown',      icon: 'bi-menu-button-wide',  needsDataSource: true  },
    { id: 'toggle',   label: 'Checkbox',      icon: 'bi-check2-square',     needsDataSource: false },
    { id: 'date',     label: 'Date',          icon: 'bi-calendar-event',    needsDataSource: false },
    { id: 'time',     label: 'Time',          icon: 'bi-clock',             needsDataSource: false },
    { id: 'datetime', label: 'Date and time', icon: 'bi-calendar-week',     needsDataSource: false },
    { id: 'hidden',   label: 'Hidden',        icon: 'bi-eye-slash',         needsDataSource: false },
];

const TYPE_BY_ID = new Map<string, FormFieldTypeDescriptor>(
    FORM_FIELD_TYPES.map((t) => [t.id, t]),
);

export function resolveFieldType(id: string | null | undefined): FormFieldTypeDescriptor {
    if (id && TYPE_BY_ID.has(id)) return TYPE_BY_ID.get(id) as FormFieldTypeDescriptor;
    return TYPE_BY_ID.get('text') as FormFieldTypeDescriptor;
}

/**
 * Constraints the picker's Validation tab surfaces. Subset of Symfony
 * Validator constraints the Form module already understands via
 * ConstraintInputParser. Args land on `FormFieldValidator.args` as a free
 * key/value map; the backend handles type coercion.
 */
export interface FormFieldValidator {
    readonly name: string;
    readonly args?: Readonly<Record<string, string | number>>;
}

export interface BuiltInValidatorDescriptor {
    readonly name:  string;
    readonly label: string;
    /** Schema for arg inputs the picker renders. */
    readonly args: ReadonlyArray<{
        readonly key:   string;
        readonly label: string;
        readonly kind:  'int' | 'string';
    }>;
}

export const BUILTIN_VALIDATORS: ReadonlyArray<BuiltInValidatorDescriptor> = [
    { name: 'NotBlank', label: 'Required (NotBlank)',                 args: [] },
    { name: 'Email',    label: 'Valid email address',                  args: [] },
    {
        name: 'Length', label: 'Length range',
        args: [
            { key: 'min', label: 'Min', kind: 'int' },
            { key: 'max', label: 'Max', kind: 'int' },
        ],
    },
    {
        name: 'Range',  label: 'Numeric range',
        args: [
            { key: 'min', label: 'Min', kind: 'int' },
            { key: 'max', label: 'Max', kind: 'int' },
        ],
    },
    {
        name: 'Regex',  label: 'Regex pattern',
        args: [{ key: 'pattern', label: 'Pattern', kind: 'string' }],
    },
];

/** Visibility operators. Mirrors VisibilityOperator enum on the PHP side. */
export const VISIBILITY_OPERATORS = ['eq', 'neq', 'in', 'nin', 'truthy', 'falsy'] as const;
export type VisibilityOperator = (typeof VISIBILITY_OPERATORS)[number];

export interface FormFieldVisibility {
    readonly field:    string;
    readonly operator: VisibilityOperator;
    readonly value?:   string;
}

/** Slugify a label into a valid fieldId (alphanumeric + underscore). */
export function slugifyFieldId(label: string): string {
    const cleaned = label.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return cleaned || 'field';
}
