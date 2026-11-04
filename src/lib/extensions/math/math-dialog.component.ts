import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { MathAttrs, MathRequest } from '@coolms/editor-client';

/**
 * The math prompt: the Angular answer to the UI port's `requestMath`
 * ({@see AngularEditorUiPort}) -- a LaTeX textarea + an inline/display toggle,
 * opened pre-filled when the request carries the selected formula. Re-uses the
 * global `cms-dialog-*` / `cms-input` / `cms-label` / `cms-hint` classes; no
 * per-component styles.
 *
 * The author types LaTeX WITHOUT the `$`/`$$` delimiters -- "Display" picks
 * `$$...$$` (centred block) vs `$...$` (inline); the handler inserts a `math`
 * node that stores the `.katex-src` span the public renderer understands.
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
                          style="font-family: var(--cms-font-mono, monospace); resize: vertical"
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
    private readonly request = inject<MathRequest | null>(DIALOG_DATA, { optional: true });

    readonly latex   = signal(this.request?.current?.latex ?? '');
    readonly display = signal(this.request?.current?.display ?? false);

    cancel(): void { this.dialogRef.close(null); }

    confirm(): void {
        const v = this.latex().trim();
        if (v === '') return;
        this.dialogRef.close({ latex: v, display: this.display() });
    }
}
