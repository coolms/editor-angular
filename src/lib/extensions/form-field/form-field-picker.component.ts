import {
    ChangeDetectionStrategy, Component, computed, effect, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormFieldAttrs } from './form-field-node';
import {
    BUILTIN_VALIDATORS, FORM_FIELD_TYPES, FormFieldType, FormFieldValidator,
    FormFieldVisibility, resolveFieldType, slugifyFieldId, VISIBILITY_OPERATORS,
    VisibilityOperator,
} from './form-field-types';

/** Tabs in declaration order. The DataSource tab is conditional on type. */
type PickerTab = 'type' | 'properties' | 'validation' | 'datasource' | 'visibility';

const TAB_LABELS: Readonly<Record<PickerTab, string>> = {
    type:        'Type',
    properties:  'Properties',
    validation:  'Validation',
    datasource:  'Data source',
    visibility:  'Visibility',
};

/**
 * Data the action handler hands to the dialog on open. `attrs` carries the
 * current node attributes when editing an existing formField; missing or
 * empty `fieldId` triggers insert mode (the picker auto-derives fieldId
 * from the label until the user explicitly overrides it).
 */
export interface FormFieldPickerData {
    readonly attrs: Partial<FormFieldAttrs>;
}

/** Result returned to the caller. `null` from `DialogRef.closed` = cancel. */
export type FormFieldPickerResult = FormFieldAttrs;

/**
 * Multi-tab picker dialog for inserting / editing a formField atom.
 *
 *   Tab 1 - Type        Grid of field types from FORM_FIELD_TYPES.
 *   Tab 2 - Properties  Label, fieldId (auto-slugified from label until the
 *                       user overrides), required, placeholder, default.
 *   Tab 3 - Validation  Built-in constraint catalogue (NotBlank, Email,
 *                       Length, Range, Regex). Each toggle can carry
 *                       per-validator args. Stored as base64-encoded JSON.
 *   Tab 4 - Datasource  Visible only when the active type needs one
 *                       (select). Inline `key=Label, key2=Label2` shorthand.
 *   Tab 5 - Visibility  Single showWhen rule (field, operator, value).
 *                       Stored as base64-encoded JSON.
 *
 * Style is inline (no SCSS) and lifts the existing dialog tokens from
 * shared/ui/dialog/dialog.styles so the picker matches the rest of the
 * admin's dialog chrome without depending on a shared tabs component
 * (none exists today).
 */
@Component({
    selector: 'app-form-field-picker',
    standalone: true,
    imports: [FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="ffp-host">
            <div class="ffp-header">
                <i class="bi bi-input-cursor-text"></i>
                <h4>{{ isEditing() ? 'Edit form field' : 'Insert form field' }}</h4>
                <button type="button" class="ffp-close" (click)="cancel()" title="Close">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <div class="ffp-tabs" role="tablist">
                @for (t of visibleTabs(); track t) {
                    <button type="button"
                            role="tab"
                            class="ffp-tab"
                            [class.ffp-tab--active]="activeTab() === t"
                            (click)="setTab(t)">
                        {{ tabLabel(t) }}
                    </button>
                }
            </div>

            <div class="ffp-body">
                @switch (activeTab()) {
                    @case ('type') {
                        <div class="ffp-type-grid">
                            @for (t of typeOptions; track t.id) {
                                <button type="button"
                                        class="ffp-type-card"
                                        [class.ffp-type-card--active]="type() === t.id"
                                        (click)="setType(t.id)">
                                    <i class="bi {{ t.icon }} ffp-type-card__icon"></i>
                                    <span class="ffp-type-card__label">{{ t.label }}</span>
                                </button>
                            }
                        </div>
                    }
                    @case ('properties') {
                        <div class="ffp-form">
                            <label class="ffp-row">
                                <span class="ffp-row__label">Label</span>
                                <input type="text"
                                       class="cms-input"
                                       [ngModel]="label()"
                                       (ngModelChange)="setLabel($event)"
                                       placeholder="Email address"
                                       [name]="'ffp-label'">
                            </label>
                            <label class="ffp-row">
                                <span class="ffp-row__label">Field ID</span>
                                <input type="text"
                                       class="cms-input"
                                       [ngModel]="fieldId()"
                                       (ngModelChange)="setFieldId($event)"
                                       [name]="'ffp-field-id'"
                                       placeholder="email_address">
                                <span class="ffp-row__hint">Letters, digits, underscores. Auto-derived from the label until you edit this directly.</span>
                            </label>
                            <label class="ffp-row ffp-row--inline">
                                <input type="checkbox"
                                       [ngModel]="required()"
                                       (ngModelChange)="setRequired($event)"
                                       [name]="'ffp-required'">
                                <span>Required</span>
                            </label>
                            <label class="ffp-row">
                                <span class="ffp-row__label">Placeholder</span>
                                <input type="text"
                                       class="cms-input"
                                       [ngModel]="placeholder()"
                                       (ngModelChange)="setPlaceholder($event)"
                                       [name]="'ffp-placeholder'">
                            </label>
                            <label class="ffp-row">
                                <span class="ffp-row__label">Default value</span>
                                <input type="text"
                                       class="cms-input"
                                       [ngModel]="defaultValue()"
                                       (ngModelChange)="setDefaultValue($event)"
                                       [name]="'ffp-default'">
                            </label>
                        </div>
                    }
                    @case ('validation') {
                        <div class="ffp-form">
                            <p class="ffp-help">Toggle one or more constraints. Numeric inputs accept integers; leave empty to skip a bound.</p>
                            @for (v of validatorCatalogue; track v.name) {
                                <div class="ffp-validator">
                                    <label class="ffp-row ffp-row--inline">
                                        <input type="checkbox"
                                               [checked]="isValidatorEnabled(v.name)"
                                               (change)="toggleValidator(v.name, $any($event.target).checked)"
                                               [name]="'ffp-v-' + v.name">
                                        <span>{{ v.label }}</span>
                                    </label>
                                    @if (isValidatorEnabled(v.name) && v.args.length > 0) {
                                        <div class="ffp-validator__args">
                                            @for (arg of v.args; track arg.key) {
                                                <label class="ffp-row ffp-row--compact">
                                                    <span class="ffp-row__label">{{ arg.label }}</span>
                                                    <input [type]="arg.kind === 'int' ? 'number' : 'text'"
                                                           class="cms-input"
                                                           [ngModel]="getValidatorArg(v.name, arg.key)"
                                                           (ngModelChange)="setValidatorArg(v.name, arg.key, $event, arg.kind)"
                                                           [name]="'ffp-v-' + v.name + '-' + arg.key">
                                                </label>
                                            }
                                        </div>
                                    }
                                </div>
                            }
                        </div>
                    }
                    @case ('datasource') {
                        <div class="ffp-form">
                            <p class="ffp-help">Inline choice list. One choice per line, format <code>value=Label</code>.</p>
                            <textarea class="cms-input ffp-textarea"
                                      rows="6"
                                      [ngModel]="datasource()"
                                      (ngModelChange)="setDatasource($event)"
                                      [name]="'ffp-datasource'"
                                      placeholder="ru=Russia
us=United States
de=Germany"></textarea>
                            <p class="ffp-row__hint">For richer datasources (API, repository, taxonomy), embed JSON or use the form-config YAML once F.5 ships.</p>
                        </div>
                    }
                    @case ('visibility') {
                        <div class="ffp-form">
                            <p class="ffp-help">Show this field only when another field meets a condition. Leave the dependency field blank to always show.</p>
                            <label class="ffp-row">
                                <span class="ffp-row__label">Depends on field ID</span>
                                <input type="text"
                                       class="cms-input"
                                       [ngModel]="visibilityField()"
                                       (ngModelChange)="setVisibilityField($event)"
                                       [name]="'ffp-vis-field'">
                            </label>
                            <label class="ffp-row">
                                <span class="ffp-row__label">Operator</span>
                                <select class="cms-input"
                                        [ngModel]="visibilityOperator()"
                                        (ngModelChange)="setVisibilityOperator($event)"
                                        [name]="'ffp-vis-op'">
                                    @for (op of operators; track op) {
                                        <option [value]="op">{{ op }}</option>
                                    }
                                </select>
                            </label>
                            @if (operatorNeedsValue()) {
                                <label class="ffp-row">
                                    <span class="ffp-row__label">Value</span>
                                    <input type="text"
                                           class="cms-input"
                                           [ngModel]="visibilityValue()"
                                           (ngModelChange)="setVisibilityValue($event)"
                                           [name]="'ffp-vis-val'">
                                </label>
                            }
                        </div>
                    }
                }
            </div>

            <div class="ffp-footer">
                <button type="button" class="cms-btn" (click)="cancel()">Cancel</button>
                <button type="button"
                        class="cms-btn cms-btn-primary"
                        [disabled]="!canApply()"
                        (click)="apply()">
                    {{ isEditing() ? 'Update' : 'Insert' }}
                </button>
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            background: var(--cms-surface);
            border-radius: var(--cms-radius-lg, 10px);
            width: min(560px, 95vw);
            max-height: min(85vh, 720px);
            box-shadow: var(--cms-shadow-lg, 0 8px 24px rgba(0,0,0,.12));
        }
        .ffp-host { display: flex; flex-direction: column; max-height: inherit; }
        .ffp-header {
            padding: 14px 18px;
            border-bottom: 1px solid var(--cms-border-light);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .ffp-header h4 { flex: 1; margin: 0; font-size: 1rem; font-weight: 600; color: var(--cms-text); }
        .ffp-close {
            width: 28px; height: 28px; border: none; background: transparent;
            cursor: pointer; color: var(--cms-text-muted); border-radius: var(--cms-radius, 6px);
            display: flex; align-items: center; justify-content: center;
        }
        .ffp-close:hover { background: var(--cms-surface-hover); color: var(--cms-text-body); }
        .ffp-tabs {
            display: flex;
            gap: 2px;
            padding: 0 14px;
            border-bottom: 1px solid var(--cms-border-light);
            background: var(--cms-surface-muted);
            overflow-x: auto;
            flex-wrap: nowrap;
        }
        .ffp-tab {
            background: transparent;
            border: none;
            padding: 10px 14px;
            cursor: pointer;
            font-size: .875rem;
            color: var(--cms-text-secondary);
            border-bottom: 2px solid transparent;
            white-space: nowrap;
        }
        .ffp-tab:hover { color: var(--cms-text); }
        .ffp-tab--active { color: var(--cms-text); border-bottom-color: var(--cms-accent); font-weight: 600; }
        .ffp-body { padding: 18px 22px; overflow-y: auto; flex: 1; }
        .ffp-form { display: flex; flex-direction: column; gap: 14px; }
        .ffp-help { color: var(--cms-text-secondary); font-size: .85rem; margin: 0 0 4px; }
        .ffp-row { display: flex; flex-direction: column; gap: 4px; }
        .ffp-row--inline { flex-direction: row; align-items: center; gap: 8px; }
        .ffp-row--compact { flex-direction: row; align-items: center; gap: 8px; }
        .ffp-row__label { font-size: .8rem; font-weight: 600; color: var(--cms-text-body); }
        .ffp-row__hint { font-size: .75rem; color: var(--cms-text-muted); }
        /* Same for .cms-input — the kit owns it, including the focus ring.
           The local copy hard-coded both the border and an rgba() of the accent
           that the ratchet's hex pattern cannot even see. */
        .cms-input { display: block; width: 100%; box-sizing: border-box; }
        .ffp-textarea { font-family: var(--cms-font-mono, monospace); min-height: 120px; }
        .ffp-type-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 8px;
        }
        .ffp-type-card {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            padding: 14px 8px;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-md, 8px);
            background: var(--cms-surface);
            cursor: pointer;
            font-size: .8rem;
            color: var(--cms-text-body);
        }
        .ffp-type-card:hover { background: var(--cms-surface-muted); border-color: var(--cms-btn-border); }
        .ffp-type-card--active {
            border-color: var(--cms-accent);
            background: color-mix(in srgb, var(--cms-accent) 8%, transparent);
            color: var(--cms-text);
        }
        .ffp-type-card__icon { font-size: 1.4rem; color: var(--cms-text-secondary); }
        .ffp-type-card--active .ffp-type-card__icon { color: var(--cms-accent); }
        .ffp-type-card__label { font-weight: 500; }
        .ffp-validator { padding: 8px 10px; border: 1px solid var(--cms-border-light); border-radius: var(--cms-radius, 6px); }
        .ffp-validator__args { margin-top: 8px; padding-left: 24px; display: flex; flex-direction: column; gap: 6px; }
        .ffp-footer {
            padding: 12px 18px 16px;
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            border-top: 1px solid var(--cms-border-light);
        }
        /* Kit shadows removed. This copy carried three literals the kit
           has tokens for — a #d1d5db border, and a #e69417 hover that is NOT
           --cms-accent-hover (#E09200), so this button hovered a different
           amber from every other primary button in the admin. */
        code {
            font-family: var(--cms-font-mono, monospace);
            background: var(--cms-surface-muted);
            padding: 1px 4px;
            border-radius: 3px;
            font-size: .85em;
        }
    `],
})
export class FormFieldPickerComponent {
    private readonly data: FormFieldPickerData = inject(DIALOG_DATA);
    private readonly ref:  DialogRef<FormFieldPickerResult | null> = inject(DialogRef);

    readonly typeOptions = FORM_FIELD_TYPES;
    readonly validatorCatalogue = BUILTIN_VALIDATORS;
    readonly operators = VISIBILITY_OPERATORS;

    // -- Form state ----------------------------------------------------------
    readonly type         = signal<FormFieldType>('text');
    readonly label        = signal<string>('');
    readonly fieldId      = signal<string>('');
    readonly required     = signal<boolean>(false);
    readonly placeholder  = signal<string>('');
    readonly defaultValue = signal<string>('');
    readonly datasource   = signal<string>('');

    /** Validators array — picker-internal shape. Encoded to base64 on apply. */
    readonly validators = signal<ReadonlyArray<FormFieldValidator>>([]);

    /** Visibility rule — picker-internal shape. Encoded to base64 on apply. */
    readonly visibilityField    = signal<string>('');
    readonly visibilityOperator = signal<VisibilityOperator>('eq');
    readonly visibilityValue    = signal<string>('');

    readonly activeTab = signal<PickerTab>('type');
    /** True when fieldId has been edited manually — disables auto-slugify. */
    readonly fieldIdManuallySet = signal<boolean>(false);

    readonly isEditing = computed(() => {
        const fid = (this.data.attrs.fieldId ?? '').toString().trim();
        return fid !== '';
    });

    readonly visibleTabs = computed<ReadonlyArray<PickerTab>>(() => {
        const base: PickerTab[] = ['type', 'properties', 'validation'];
        if (resolveFieldType(this.type()).needsDataSource) base.push('datasource');
        base.push('visibility');
        return base;
    });

    readonly canApply = computed<boolean>(() => {
        const fid = this.fieldId().trim();
        if (fid === '') return false;
        if (!/^[A-Za-z0-9_]+$/.test(fid)) return false;
        return true;
    });

    constructor() {
        // Seed picker state from incoming attrs (edit mode) or defaults (insert).
        const attrs = this.data.attrs;
        this.type.set((attrs.type as FormFieldType | undefined) ?? 'text');
        this.label.set((attrs.label ?? ''));
        this.fieldId.set((attrs.fieldId ?? ''));
        this.required.set(attrs.required === true);
        this.placeholder.set((attrs.placeholder ?? ''));
        this.defaultValue.set((attrs.defaultValue ?? ''));
        this.datasource.set((attrs.datasource ?? ''));
        this.fieldIdManuallySet.set((attrs.fieldId ?? '') !== '');

        const validationRaw = (attrs.validation ?? '');
        if (validationRaw !== '') {
            try {
                const parsed = JSON.parse(decodeBase64(validationRaw)) as FormFieldValidator[];
                if (Array.isArray(parsed)) this.validators.set(parsed);
            } catch {
                // Malformed payload — ignore so the user can re-author from
                // a clean slate rather than seeing a crashed dialog.
            }
        }

        const visibilityRaw = (attrs.visibility ?? '');
        if (visibilityRaw !== '') {
            try {
                const parsed = JSON.parse(decodeBase64(visibilityRaw)) as FormFieldVisibility;
                this.visibilityField.set(parsed.field ?? '');
                this.visibilityOperator.set(parsed.operator ?? 'eq');
                this.visibilityValue.set(parsed.value ?? '');
            } catch {
                // Same rationale as the validation branch.
            }
        }

        // Auto-slug when the user hasn't explicitly edited fieldId yet.
        effect(() => {
            const lbl = this.label();
            if (this.fieldIdManuallySet()) return;
            const slug = slugifyFieldId(lbl);
            this.fieldId.set(slug);
        });
    }

    tabLabel(tab: PickerTab): string {
        return TAB_LABELS[tab];
    }

    setTab(tab: PickerTab): void {
        this.activeTab.set(tab);
    }

    setType(t: FormFieldType): void {
        this.type.set(t);
        // When the new type doesn't need a datasource, clear any existing
        // shorthand to keep the saved attribute set tidy.
        if (!resolveFieldType(t).needsDataSource) this.datasource.set('');
    }

    setLabel(value: string): void {
        this.label.set(value);
    }

    setFieldId(value: string): void {
        this.fieldId.set(value);
        this.fieldIdManuallySet.set(true);
    }

    setRequired(value: boolean): void {
        this.required.set(value);
    }

    setPlaceholder(value: string): void {
        this.placeholder.set(value);
    }

    setDefaultValue(value: string): void {
        this.defaultValue.set(value);
    }

    setDatasource(value: string): void {
        this.datasource.set(value);
    }

    isValidatorEnabled(name: string): boolean {
        return this.validators().some((v) => v.name === name);
    }

    toggleValidator(name: string, on: boolean): void {
        const current = this.validators();
        if (on && !current.some((v) => v.name === name)) {
            this.validators.set([...current, { name }]);
        } else if (!on) {
            this.validators.set(current.filter((v) => v.name !== name));
        }
    }

    getValidatorArg(name: string, key: string): string {
        const v = this.validators().find((x) => x.name === name);
        const args = v?.args;
        if (!args) return '';
        const raw = args[key];
        return raw === undefined ? '' : String(raw);
    }

    setValidatorArg(name: string, key: string, value: string, kind: 'int' | 'string'): void {
        const current = this.validators();
        const idx = current.findIndex((v) => v.name === name);
        if (idx === -1) return;
        const existing = current[idx];
        const nextArgs: Record<string, string | number> = { ...(existing.args ?? {}) };
        if (value === '') {
            delete nextArgs[key];
        } else if (kind === 'int') {
            const parsed = parseInt(value, 10);
            if (Number.isFinite(parsed)) nextArgs[key] = parsed;
        } else {
            nextArgs[key] = value;
        }
        const next: FormFieldValidator = Object.keys(nextArgs).length > 0
            ? { name: existing.name, args: nextArgs }
            : { name: existing.name };
        const out = [...current];
        out[idx] = next;
        this.validators.set(out);
    }

    setVisibilityField(value: string): void {
        this.visibilityField.set(value);
    }

    setVisibilityOperator(value: VisibilityOperator): void {
        this.visibilityOperator.set(value);
    }

    setVisibilityValue(value: string): void {
        this.visibilityValue.set(value);
    }

    operatorNeedsValue(): boolean {
        const op = this.visibilityOperator();
        return op !== 'truthy' && op !== 'falsy';
    }

    cancel(): void {
        this.ref.close(null);
    }

    apply(): void {
        if (!this.canApply()) return;

        const validators = this.validators();
        const validationEncoded = validators.length > 0
            ? encodeBase64(JSON.stringify(validators))
            : '';

        const visField = this.visibilityField().trim();
        let visibilityEncoded = '';
        if (visField !== '') {
            const op = this.visibilityOperator();
            const payload: FormFieldVisibility = this.operatorNeedsValue()
                ? { field: visField, operator: op, value: this.visibilityValue() }
                : { field: visField, operator: op };
            visibilityEncoded = encodeBase64(JSON.stringify(payload));
        }

        const result: FormFieldAttrs = {
            fieldId:      this.fieldId().trim(),
            type:         this.type(),
            label:        this.label(),
            required:     this.required(),
            placeholder:  this.placeholder().trim() === '' ? null : this.placeholder(),
            defaultValue: this.defaultValue().trim() === '' ? null : this.defaultValue(),
            validation:   validationEncoded,
            datasource:   this.datasource().trim(),
            visibility:   visibilityEncoded,
        };
        this.ref.close(result);
    }
}

/**
 * Browser-safe base64 encode of a UTF-8 string. `btoa` requires Latin-1 in;
 * percent-encoding via encodeURIComponent first lets us round-trip arbitrary
 * Unicode payloads (validation messages with non-ASCII, visibility values).
 */
function encodeBase64(s: string): string {
    return btoa(encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, h: string) =>
        String.fromCharCode(parseInt(h, 16)),
    ));
}

function decodeBase64(s: string): string {
    return decodeURIComponent(Array.from(atob(s)).map((ch) =>
        '%' + ch.charCodeAt(0).toString(16).padStart(2, '0'),
    ).join(''));
}
