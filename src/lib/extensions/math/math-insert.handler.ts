import { Dialog, DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { NodeSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import type { EditorActionContext, EditorActionHandler } from '../../editor.types';
import type { MathAttrs } from './math-node';

/** Pre-fill payload passed to the dialog when editing an existing formula. */
type MathDialogData = MathAttrs;

/**
 * Tiny inline dialog for the math prompt — a LaTeX textarea + an inline/display
 * toggle. Lives next to the handler (tightly coupled, mirrors
 * EditorEmbedDialogComponent). Re-uses the global `cms-dialog-*` / `cms-input` /
 * `cms-label` / `cms-hint` classes; no per-component styles.
 *
 * The author types LaTeX WITHOUT the `$`/`$$` delimiters — "Display" picks
 * `$$…$$` (centred block) vs `$…$` (inline); on confirm the handler inserts a
 * `math` node that stores the `.katex-src` span the public renderer understands.
 */
@Component({
    selector: 'coolms-editor-math-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="cms-dialog" style="width:460px; max-width:95vw">
            <div class="cms-dialog-header">
                <span><i class="bi bi-calculator me-1"></i> Insert math</span>
            </div>
            <div class="cms-dialog-body" style="padding:16px">
                <label class="cms-label" for="math-latex">LaTeX</label>
                <textarea id="math-latex" class="cms-input" rows="3" autofocus
                          style="font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; resize: vertical"
                          placeholder="e.g.  E = mc^2   or   \\int_0^1 x\\,dx"
                          [ngModel]="latex()"
                          (ngModelChange)="latex.set($event)"
                          (keydown.control.enter)="confirm()"></textarea>
                <p class="cms-hint" style="margin:4px 0 12px">
                    Type LaTeX without the <code>$</code> delimiters. Rendered with
                    KaTeX; an invalid formula shows its source rather than breaking
                    the page. Ctrl+Enter to insert.
                </p>

                <label class="cms-label" style="display:flex; align-items:center; gap:8px; cursor:pointer">
                    <input type="checkbox"
                           [ngModel]="display()"
                           (ngModelChange)="display.set($event)" />
                    Display mode <span class="cms-hint">(centred block — <code>$$…$$</code>)</span>
                </label>
            </div>
            <div class="cms-dialog-footer">
                <button type="button" class="cms-btn cms-btn-sm" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-sm cms-btn-primary"
                        [disabled]="latex().trim() === ''"
                        (click)="confirm()">Insert</button>
            </div>
        </div>
    `,
})
export class EditorMathDialogComponent {
    private readonly dialogRef = inject<DialogRef<MathAttrs | null>>(DialogRef);
    private readonly data = inject<MathDialogData | null>(DIALOG_DATA, { optional: true });

    readonly latex   = signal(this.data?.latex ?? '');
    readonly display = signal(this.data?.display ?? false);

    cancel(): void { this.dialogRef.close(null); }

    confirm(): void {
        const v = this.latex().trim();
        if (v === '') return;
        this.dialogRef.close({ latex: v, display: this.display() });
    }
}

/**
 * Handles `math.insert`. Opens {@link EditorMathDialogComponent}; on confirm,
 * inserts a `math` node (or updates the one already selected, so the toolbar
 * button edits a formula in place rather than stacking a duplicate).
 *
 * Stateless / dependency-free: CDK Dialog is fetched lazily through
 * `ctx.injector.get(Dialog)` (mirrors EmbedInsertHandler), so the handler is
 * registered with a plain `new MathInsertHandler()`.
 */
export class MathInsertHandler implements EditorActionHandler {
    async execute(_params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): Promise<void> {
        const dialog = ctx.injector.get(Dialog);
        const existing = this.detectExisting(ctx.editor);

        const ref = dialog.open<MathAttrs | null>(EditorMathDialogComponent, {
            data: existing,
            backdropClass: 'cdk-overlay-dark-backdrop',
        });

        const result = await firstValueFrom(ref.closed);
        if (!result) return; // cancelled

        // upsertMath (MathNode.addCommands) updates in place when a math node is
        // selected, otherwise inserts at the cursor.
        ctx.editor.chain().focus().upsertMath(result).run();
    }

    /**
     * Probe the selection for a math node so the dialog opens pre-filled
     * (edit-in-place). Returns null for a fresh insert.
     */
    private detectExisting(editor: Editor): MathDialogData | null {
        const sel = editor.state.selection;
        if (sel instanceof NodeSelection && sel.node.type.name === 'math') {
            const a = sel.node.attrs as Record<string, unknown>;
            return { latex: String(a['latex'] ?? ''), display: Boolean(a['display']) };
        }
        return null;
    }
}
