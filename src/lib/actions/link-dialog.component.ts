import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { LinkRequest } from '@coolms/editor-client';

/**
 * The link prompt: the Angular answer to the UI port's `requestLink`
 * ({@see AngularEditorUiPort}). Opens with the link under the cursor when the
 * request carries one; closes with the URL, or null on cancel. CMS tokens via
 * the global `cms-dialog-*` classes (no per-component styles to drift).
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
    private readonly data = inject<LinkRequest | null>(DIALOG_DATA, { optional: true });
    readonly url = signal(this.data?.currentHref ?? '');

    cancel(): void { this.dialogRef.close(null); }
    confirm(): void {
        const u = this.url().trim();
        if (u !== '') this.dialogRef.close(u);
    }
}
