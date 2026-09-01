import { ChangeDetectionStrategy, Component, InjectionToken, inject } from '@angular/core';
import type { Editor } from '@tiptap/core';
import {
    TABLE_MENU_GROUPS,
    currentRowHeight,
    currentRowRepeatsHeader,
    runTableCommand,
    setRowHeight,
    setRowRepeatHeader,
    type TableMenuButton,
} from './table-commands';

/** Data handed to the bubble menu when {@link TableBubbleMenuController} mounts it. */
export interface TableBubbleMenuData {
    readonly editor: Editor;
}

export const TABLE_BUBBLE_MENU_DATA = new InjectionToken<TableBubbleMenuData>('TABLE_BUBBLE_MENU_DATA');

/**
 * Floating toolbar shown while the caret is inside a table. Rendered into a CDK
 * overlay by {@link TableBubbleMenuController}, anchored above the table.
 *
 * `mousedown.preventDefault()` on the bar keeps focus + the ProseMirror
 * selection in the editor when a button is pressed — essential so commands that
 * act on a cell-selection (`mergeCells`) or the current column (`align*`) still
 * see it. Buttons are stateless action triggers (parity with the grid / table
 * pickers); the menu shows/hides purely on table membership, not per-cell state.
 */
@Component({
    selector: 'app-table-bubble-menu',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="tbm" (mousedown)="$event.preventDefault()">
            @for (group of groups; track group.key) {
                <div class="tbm__group">
                    @for (btn of group.buttons; track btn.command) {
                        <button type="button" class="tbm__btn"
                                [title]="btn.label" [attr.aria-label]="btn.label"
                                (click)="run(btn)">
                            <i [class]="'bi ' + btn.icon"></i>
                        </button>
                    }
                </div>
            }
            <!-- A height is a NUMBER, so it cannot be one of the icon buttons
                 above however the list is arranged. Its own group, at the end,
                 beside the row controls it belongs with. Empty means "as tall
                 as the tallest cell", which is what a row does unasked. -->
            <div class="tbm__group tbm__group--height">
                <label class="tbm__label" [title]="HEIGHT_HINT">
                    Row
                    <input class="tbm__number"
                           type="number" min="1" step="1"
                           placeholder="auto"
                           aria-label="Row height in points"
                           [value]="rowHeight() ?? ''"
                           (change)="applyRowHeight($any($event.target).value)" />
                    pt
                </label>
                <!-- A CHECKBOX, not one more icon button: it is a state the row
                     is in rather than an action, and the icon row above says
                     nothing about what is currently on. -->
                <label class="tbm__label" [title]="REPEAT_HINT">
                    <input type="checkbox"
                           aria-label="Repeat this row at the top of every page"
                           [checked]="rowRepeats()"
                           (change)="applyRowRepeat($any($event.target).checked)" />
                    Repeat
                </label>
            </div>
        </div>
    `,
    styles: [`
        .tbm {
            display: flex;
            align-items: center;
            gap: 2px;
            padding: 4px;
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-md, 8px);
            box-shadow: var(--cms-shadow-lg, 0 8px 24px rgba(0,0,0,.12));
            user-select: none;
        }
        .tbm__group {
            display: inline-flex;
            gap: 1px;
            padding: 0 3px;
            border-right: 1px solid var(--cms-border);
        }
        .tbm__group:last-child { border-right: none; }
        .tbm__btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            padding: 0;
            background: transparent;
            border: 1px solid transparent;
            border-radius: var(--cms-radius, 6px);
            color: var(--cms-text-body);
            cursor: pointer;
            font-size: .9rem;
            line-height: 1;
        }
        .tbm__btn:hover {
            background: color-mix(in srgb, var(--cms-accent) 12%, transparent);
            border-color: color-mix(in srgb, var(--cms-accent) 50%, transparent);
            color: var(--cms-accent-text);
        }
        .tbm__group--height { border-right: none; }
        .tbm__label {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin: 0;
            padding: 0 2px;
            color: var(--cms-text-muted);
            font-size: .75rem;
            white-space: nowrap;
        }
        .tbm__number {
            width: 3.5rem;
            padding: 2px 4px;
            background: var(--cms-surface);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm, 4px);
            color: var(--cms-text-body);
            font: inherit;
        }
    `],
})
export class TableBubbleMenuComponent {
    private readonly data = inject(TABLE_BUBBLE_MENU_DATA);
    readonly groups = TABLE_MENU_GROUPS;

    /**
     * Said in the tooltip rather than left to be discovered: a stated height is
     * a FLOOR, which is what Word's default `atLeast` rule means. An author who
     * expects it to clip needs to know it will not.
     */
    protected readonly HEIGHT_HINT =
        'Minimum row height in points — the row still grows for content that needs more. Empty fits the content.';

    /**
     * ⚠️ MEASURED, both halves, because the first two things written here were
     * wrong in opposite directions. `paginateFlow` really does repeat the row,
     * so the canvas reserves its height at the top of every page — unticking
     * this moved the page gaps by exactly one row (256px → 220px, #2294). What
     * it does NOT do is paint the row into that space, because the repeat is a
     * layout result and the canvas draws the author's document.
     *
     * Saying "the canvas ignores it" would contradict a page that visibly moved;
     * saying "it draws it" would contradict the blank band.
     */
    protected readonly REPEAT_HINT =
        'Repeat this row at the top of every page in Word. The canvas leaves room for it but does not draw it.';

    run(btn: TableMenuButton): void {
        runTableCommand(this.data.editor, btn.command);
    }

    /** The caret's row height, for the input to show. */
    protected rowHeight(): number | null {
        return currentRowHeight(this.data.editor);
    }

    protected applyRowHeight(raw: string): void {
        const points = Number.parseFloat(raw);

        setRowHeight(this.data.editor, Number.isFinite(points) && points > 0 ? points : null);
    }

    /** Whether the caret's row repeats, for the checkbox to show. */
    protected rowRepeats(): boolean {
        return currentRowRepeatsHeader(this.data.editor);
    }

    protected applyRowRepeat(repeat: boolean): void {
        setRowRepeatHeader(this.data.editor, repeat);
    }
}
