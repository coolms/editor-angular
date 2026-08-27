import { Dialog, DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { NodeSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import type { EditorActionContext, EditorActionHandler } from '../../editor.types';
import {
    EMBED_KINDS, EMBED_RATIOS, kindUsesRatio,
    type EmbedKind, type EmbedRatio, type EmbedWidgetAttrs,
    normalizeKind, normalizeRatio,
} from './dtmpl-embed-node';

/** Pre-fill payload passed to the dialog when editing an existing embed. */
type EmbedDialogData = EmbedWidgetAttrs;

/** Human label per kind for the kind `<select>`. */
const KIND_LABELS: Record<EmbedKind, string> = {
    video:  'Video (YouTube, Vimeo)',
    iframe: 'Web page / map (iframe)',
    audio:  'Audio (Spotify, SoundCloud, file)',
};

/** URL-input placeholder per kind. */
const KIND_PLACEHOLDERS: Record<EmbedKind, string> = {
    video:  'https://youtu.be/… or https://vimeo.com/…',
    iframe: 'Google Maps / OpenStreetMap / CodePen / CodeSandbox URL',
    audio:  'Spotify / SoundCloud URL, or a direct .mp3 / .ogg file',
};

/**
 * Tiny inline dialog for the embed prompt — kind + URL (required) + aspect ratio
 * (hidden for audio) + optional title. Lives next to the handler since they're
 * tightly coupled (mirrors EditorLinkDialogComponent). Re-uses the global
 * `cms-dialog-*` / `cms-input` / `cms-select` classes, no per-component styles.
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
                    @for (k of kinds; track k) {
                        <option [value]="k">{{ kindLabels[k] }}</option>
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
    private readonly dialogRef = inject<DialogRef<EmbedWidgetAttrs | null>>(DialogRef);
    private readonly data = inject<EmbedDialogData | null>(DIALOG_DATA, { optional: true });

    readonly kinds      = EMBED_KINDS;
    readonly ratios     = EMBED_RATIOS;
    readonly kindLabels = KIND_LABELS;

    readonly kind  = signal<EmbedKind>(normalizeKind(this.data?.kind));
    readonly url   = signal(this.data?.url ?? '');
    readonly ratio = signal<EmbedRatio>(normalizeRatio(this.data?.ratio));
    readonly title = signal(this.data?.title ?? '');

    readonly showRatio      = computed(() => kindUsesRatio(this.kind()));
    readonly urlPlaceholder = computed(() => KIND_PLACEHOLDERS[this.kind()]);

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

/**
 * Handles `embed.insert`. Opens {@link EditorEmbedDialogComponent}; on confirm,
 * inserts a `dtmplEmbed` node (or updates the one already selected, so the
 * toolbar button edits an embed in place rather than stacking a duplicate).
 *
 * Stateless / dependency-free: CDK Dialog is fetched lazily through
 * `ctx.injector.get(Dialog)` (mirrors EditorOpenLinkDialogHandler), so the
 * handler is registered with a plain `new EmbedInsertHandler()`.
 */
export class EmbedInsertHandler implements EditorActionHandler {
    async execute(_params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): Promise<void> {
        const dialog = ctx.injector.get(Dialog);
        const existing = this.detectExisting(ctx.editor);

        const ref = dialog.open<EmbedWidgetAttrs | null>(EditorEmbedDialogComponent, {
            data: existing,
            backdropClass: 'cdk-overlay-dark-backdrop',
        });

        const result = await firstValueFrom(ref.closed);
        if (!result) return; // cancelled

        // upsertEmbed (DtmplEmbedNode.addCommands) updates in place when a
        // dtmplEmbed node is selected, otherwise inserts at the cursor.
        ctx.editor.chain().focus().upsertEmbed(result).run();
    }

    /**
     * Probe the selection for a dtmplEmbed node so the dialog opens pre-filled
     * (edit-in-place). Returns null for a fresh insert.
     */
    private detectExisting(editor: Editor): EmbedDialogData | null {
        const sel = editor.state.selection;
        if (sel instanceof NodeSelection && sel.node.type.name === 'dtmplEmbed') {
            const a = sel.node.attrs as Record<string, unknown>;
            return {
                kind:  normalizeKind(a['kind'] as string),
                url:   String(a['url'] ?? ''),
                ratio: normalizeRatio(a['ratio'] as string),
                title: String(a['title'] ?? ''),
            };
        }
        return null;
    }
}
