import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { EditorActionContext, EditorActionHandler } from '../editor.types';

/**
 * Tiny inline dialog component for the link prompt. Lives next to the
 * handler since they're tightly coupled and adding it to the public API
 * would only invite consumers to re-skin a 3-line form. CMS tokens via
 * the existing `cms-dialog-*` global classes (no per-component styles
 * to drift).
 */
@Component({
    selector: 'coolms-editor-link-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="cms-dialog" style="width:420px; max-width:95vw">
            <div class="cms-dialog-header">
                <span><i class="bi bi-link-45deg me-1"></i> Insert link</span>
            </div>
            <div class="cms-dialog-body" style="padding:16px">
                <label class="cms-label" for="link-url">URL</label>
                <input id="link-url" class="cms-input" type="url" autofocus
                       placeholder="https://example.com"
                       [ngModel]="url()"
                       (ngModelChange)="url.set($event)"
                       (keydown.enter)="confirm()" />
            </div>
            <div class="cms-dialog-footer">
                <button type="button" class="cms-btn cms-btn-sm" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-sm cms-btn-primary"
                        [disabled]="url().trim() === ''"
                        (click)="confirm()">Apply</button>
            </div>
        </div>
    `,
})
export class EditorLinkDialogComponent {
    private readonly dialogRef = inject<DialogRef<string | null>>(DialogRef);
    readonly url = signal('');

    cancel(): void { this.dialogRef.close(null); }
    confirm(): void {
        const u = this.url().trim();
        if (u !== '') this.dialogRef.close(u);
    }
}

/**
 * Handles `editor.openLinkDialog`. Opens a CDK Dialog with a URL input;
 * on confirm, applies the `link` mark to the current selection (or extends
 * the selection over the typed URL when no text is selected).
 */
export class EditorOpenLinkDialogHandler implements EditorActionHandler {
    async execute(_params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): Promise<void> {
        const dialog = ctx.injector.get(Dialog);
        const ref = dialog.open<string | null>(EditorLinkDialogComponent, {
            backdropClass: 'cdk-overlay-dark-backdrop',
        });
        const url = await firstValueFrom(ref.closed);
        if (!url) return;

        const { from, to } = ctx.editor.state.selection;
        if (from === to) {
            // No selection — insert the URL as visible text and link it.
            ctx.editor.chain().focus()
                .insertContent(url)
                .setTextSelection({ from, to: from + url.length })
                .setLink({ href: url })
                .run();
        } else {
            ctx.editor.chain().focus().setLink({ href: url }).run();
        }
    }
}
