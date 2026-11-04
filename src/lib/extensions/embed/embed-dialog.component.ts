import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { EmbedAttrs, EmbedRequest } from '@coolms/editor-client';

/**
 * URL-input placeholder per kind -- presentation, so it lives with the dialog;
 * a kind the request carries and this map does not know gets a plain hint.
 */
const KIND_PLACEHOLDERS: Readonly<Record<string, string>> = {
    video:  'https://youtu.be/… or https://vimeo.com/…',
    iframe: 'Google Maps / OpenStreetMap / CodePen / CodeSandbox URL',
    audio:  'Spotify / SoundCloud URL, or a direct .mp3 / .ogg file',
};

/**
 * The embed prompt: the Angular answer to the UI port's `requestEmbed`
 * ({@see AngularEditorUiPort}) -- kind + URL (required) + aspect ratio (only for
 * a kind that uses one) + optional title. The kinds, their labels and the
 * ratios are the ones the request carries; the dialog holds no copy of the
 * schema. Re-uses the global `cms-dialog-*` / `cms-input` / `cms-select`
 * classes, no per-component styles.
 */
@Component({
    selector: 'coolms-editor-embed-dialog',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [FormsModule],
    template: `
        <div class="cms-dialog" style="width:460px; max-width:95vw">
            <div class="cms-dialog-header">
                <span><i class="bi bi-collection-play me-1"></i> Insert embed</span>
            </div>
            <div class="cms-dialog-body" style="padding:16px">
                <label class="cms-label" for="embed-kind">Type</label>
                <select id="embed-kind" class="cms-select"
                        [ngModel]="kind()"
                        (ngModelChange)="kind.set($event)">
                    @for (k of kinds; track k.id) {
                        <option [value]="k.id">{{ k.label }}</option>
                    }
                </select>

                <label class="cms-label" for="embed-url" style="margin-top:12px">URL</label>
                <input id="embed-url" class="cms-input" type="url" autofocus
                       [placeholder]="urlPlaceholder()"
                       [ngModel]="url()"
                       (ngModelChange)="url.set($event)"
                       (keydown.enter)="confirm()" />
                <p class="cms-hint" style="margin:4px 0 12px">
                    The link is validated server-side against an allow-list; an
                    unsupported host renders nothing.
                </p>

                @if (showRatio()) {
                    <label class="cms-label" for="embed-ratio">Aspect ratio</label>
                    <select id="embed-ratio" class="cms-select"
                            [ngModel]="ratio()"
                            (ngModelChange)="ratio.set($event)">
                        @for (r of ratios; track r) {
                            <option [value]="r">{{ r.replace('x', ':') }}</option>
                        }
                    </select>
                }

                <label class="cms-label" for="embed-title" style="margin-top:12px">
                    Title <span class="cms-hint">(optional)</span>
                </label>
                <input id="embed-title" class="cms-input" type="text"
                       placeholder="Accessible label for the embed"
                       [ngModel]="title()"
                       (ngModelChange)="title.set($event)"
                       (keydown.enter)="confirm()" />
            </div>
            <div class="cms-dialog-footer">
                <button type="button" class="cms-btn cms-btn-sm" (click)="cancel()">Cancel</button>
                <button type="button" class="cms-btn cms-btn-sm cms-btn-primary"
                        [disabled]="url().trim() === ''"
                        (click)="confirm()">Insert</button>
            </div>
        </div>
    `,
})
export class EditorEmbedDialogComponent {
    private readonly dialogRef = inject<DialogRef<EmbedAttrs | null>>(DialogRef);
    private readonly request = inject<EmbedRequest>(DIALOG_DATA);

    readonly kinds  = this.request.kinds;
    readonly ratios = this.request.ratios;

    readonly kind  = signal<string>(this.request.current?.kind ?? this.kinds[0]?.id ?? '');
    readonly url   = signal(this.request.current?.url ?? '');
    readonly ratio = signal<string>(this.request.current?.ratio ?? this.ratios[0] ?? '');
    readonly title = signal(this.request.current?.title ?? '');

    readonly showRatio = computed(() => this.kinds.find((k) => k.id === this.kind())?.usesRatio ?? false);
    readonly urlPlaceholder = computed(() => KIND_PLACEHOLDERS[this.kind()] ?? 'https://…');

    cancel(): void { this.dialogRef.close(null); }

    confirm(): void {
        const u = this.url().trim();
        if (u === '') return;
        this.dialogRef.close({
            kind:  this.kind(),
            url:   u,
            ratio: this.ratio(),
            title: this.title().trim(),
        });
    }
}
