import {
    ChangeDetectionStrategy, Component, ElementRef, InjectionToken, type Signal,
    ViewEncapsulation, effect, inject,
} from '@angular/core';
import type { SlashCommandGroup, SlashCommandItem } from './slash-menu-types';

/**
 * Reactive state the {@link SlashMenuController} shares with the popup through
 * DI (same pattern as the grid picker's PICKER_DATA): the controller owns the
 * signals and mutates them as the user types / arrows; the component renders
 * from them. Clicks + hovers are reported back through the callbacks.
 *
 * Keyboard navigation is owned by the controller (driven from the ProseMirror
 * plugin's `handleKeyDown`, since the editor — not this popup — keeps DOM
 * focus while the user types). The component is a pure view: it never installs
 * key listeners.
 */
export interface SlashMenuData {
    readonly groups:      Signal<ReadonlyArray<SlashCommandGroup>>;
    /** Flat index (across all groups, in display order) of the highlighted item. */
    readonly activeIndex: Signal<number>;
    pick(item: SlashCommandItem): void;
    hover(flatIndex: number): void;
}

export const SLASH_MENU_DATA = new InjectionToken<SlashMenuData>('SLASH_MENU_DATA');

/** A group plus the flat indices of its items, computed for the template. */
interface RenderedGroup {
    readonly key:     string;
    readonly heading: string;
    readonly items:   ReadonlyArray<{ item: SlashCommandItem; flatIndex: number }>;
}

/**
 * Floating command palette shown at the caret while a `/`-trigger is active.
 * Rendered into a CDK overlay by {@link SlashMenuController}.
 *
 * `mousedown.preventDefault()` keeps the editor selection intact when an item
 * is clicked, so the command runs against the trigger range the controller
 * captured (mirrors the table bubble-menu).
 */
@Component({
    selector: 'app-slash-menu',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None,
    template: `
        <div class="sm" (mousedown)="$event.preventDefault()">
            @for (group of rendered(); track group.key) {
                <div class="sm__group-heading">{{ group.heading }}</div>
                @for (row of group.items; track row.item.id) {
                    <button type="button"
                            class="sm__item"
                            [class.sm__item--active]="row.flatIndex === data.activeIndex()"
                            [attr.data-flat-index]="row.flatIndex"
                            (mouseenter)="data.hover(row.flatIndex)"
                            (click)="data.pick(row.item)">
                        <span class="sm__icon"><i [class]="'bi ' + row.item.icon"></i></span>
                        <span class="sm__label">{{ row.item.label }}</span>
                    </button>
                }
            }
        </div>
    `,
    styles: [`
        .sm {
            min-width: 232px;
            max-width: 320px;
            max-height: 320px;
            overflow-y: auto;
            padding: 6px;
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
            user-select: none;
            font-size: .875rem;
        }
        .sm__group-heading {
            padding: 6px 8px 2px;
            font-size: .68rem;
            font-weight: 700;
            letter-spacing: .04em;
            text-transform: uppercase;
            color: var(--cms-text-muted);
        }
        .sm__item {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            padding: 6px 8px;
            background: transparent;
            border: none;
            border-radius: 6px;
            color: var(--cms-text-body);
            cursor: pointer;
            text-align: left;
            line-height: 1.3;
        }
        .sm__item--active { background: color-mix(in srgb, var(--cms-accent) 14%, transparent); color: #b07014; }
        .sm__icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            flex: 0 0 24px;
            border: 1px solid var(--cms-border);
            border-radius: 5px;
            font-size: .9rem;
            color: var(--cms-text-secondary);
        }
        .sm__item--active .sm__icon { border-color: color-mix(in srgb, var(--cms-accent) 50%, transparent); color: #b07014; }
        .sm__label { flex: 1 1 auto; }
    `],
})
export class SlashMenuComponent {
    readonly data = inject(SLASH_MENU_DATA);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

    /** Re-derives flat indices whenever the (already filtered + grouped) list changes. */
    readonly rendered = (): ReadonlyArray<RenderedGroup> => {
        let flat = 0;
        return this.data.groups().map((g) => ({
            key:     g.key,
            heading: g.heading,
            items:   g.items.map((item) => ({ item, flatIndex: flat++ })),
        }));
    };

    constructor() {
        // Keep the highlighted row visible as arrow-key navigation moves it.
        effect(() => {
            const index = this.data.activeIndex();
            queueMicrotask(() => {
                const el = this.host.nativeElement.querySelector<HTMLElement>(
                    `.sm__item[data-flat-index="${index}"]`,
                );
                el?.scrollIntoView({ block: 'nearest' });
            });
        });
    }
}
