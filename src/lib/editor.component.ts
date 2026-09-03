import {
    AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, Injector,
    OnDestroy, ViewChild, ViewEncapsulation, computed, effect, inject, input,
    model, signal, untracked,
} from '@angular/core';
import { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
    ContentAdapter, EDITOR_MANIFEST_PROVIDER, EDITOR_TRANSLATE,
    EditorActionContext, EditorProfileManifest, EditorToolbarNodeManifest,
} from './editor.types';
import { FORM_FIELD_EDIT_EVENT, FormFieldEditEventDetail } from './extensions/form-field/form-field-node-view';
import { createDragHandle } from './extensions/drag-handle/drag-handle-extension';
import Underline from '@tiptap/extension-underline';

import { CoolmsTextStyle, TextStyleAttributes } from './text-style-mark';
import { DocumentImageNode } from './extensions/image/document-image-node';
import { FootnoteReferenceNode } from './extensions/footnote/footnote-reference-node';
import { SectionBreakNode } from './extensions/page-break/section-break-node';
import { CmsTextAlignExtension } from './extensions/align/text-align-extension';
// From core, not from the kit: the kit imports this package's editor for
// its richtext field, so a kit import here would close a cycle and neither
// could be a package.
import { CmsLoaderComponent } from '@coolms/core-angular';
import { createPasteCleanup } from './extensions/paste-cleanup/paste-cleanup-extension';
import { buildSlashItems } from './extensions/slash-menu/slash-command-filter';
import { createSlashMenu } from './extensions/slash-menu/slash-menu-extension';
import type { SlashCommandItem } from './extensions/slash-menu/slash-menu-types';
import { EditorActionRegistry } from './registry/editor-action-registry';
import { ZOOM_MAX, ZOOM_MIN, fitZoomFor } from './fit-zoom';
import { EditorExtensionRegistry } from './registry/editor-extension-registry';
import type { BorderStyle, FontCatalogue } from '@coolms/document-engine';
import { faceIsLoaded, loadDocumentFonts, loadFontManifest } from './pagination/document-fonts';
import { flowBlocksFromDoc, fontFamiliesIn, rowPositionOf, type BlockBox } from './pagination/flow-blocks';
import {
    createPagination, gapHeightHost, lineBoxesFrom, lineBoxKey, paginationKey,
    type PageGap,
} from './pagination/pagination-extension';
import { repeatedHeadersOf, type RepeatedHeader } from './pagination/repeated-headers';
import { loadPaginationEngine, paginationEngine } from './pagination/engine';

interface ToolbarGroup {
    readonly name:  string;
    readonly nodes: ReadonlyArray<EditorToolbarNodeManifest>;
}

/**
 * One cluster the toolbar draws, in the order it draws them.
 *
 * ## Why the font pickers are a SLOT rather than a contributor
 *
 * The reported complaint was "font tools, then forms and media, then
 * font tools again". It was accurate, and the cause was a level below the
 * ordering: the font family, size and colour controls were hard-coded in the
 * template AFTER the loop over contributed groups, so no `group`/`priority` in
 * any manifest could ever move them next to Bold and Italic. They were not late
 * in the order; they were outside it.
 *
 * Making them contributors proper is the tidier-sounding fix and is NOT what
 * this is: the manifest describes an icon button bound to an action id, and a
 * font family is a `<select>`, a size is a number input, a colour is
 * `<input type=color>`. Teaching the contribution model about control KINDS is
 * a real slice with a wire format to agree, and it buys nothing until someone
 * outside this component needs to contribute a select.
 *
 * So the editor's own clusters take part in the ORDERING without taking part in
 * the contribution model: one list, built here, holding both. That is also the
 * seam a future drag-to-reorder would reorder — it can sort slots without
 * caring which kind each one is.
 */
type ToolbarSlot =
    | { readonly key: string; readonly kind: 'nodes'; readonly nodes: ReadonlyArray<EditorToolbarNodeManifest> }
    | { readonly key: string; readonly kind: 'font' };

/**
 * Paper dimensions for the paged canvas, as CSS lengths with the
 * orientation already applied. Produced by `PageSizeResolver::sheetGeometry()`
 * from the SAME array the DOCX renderer hands PHPWord, so the sheet on screen
 * and the paper in the file are the same numbers in different units.
 */
export interface PageGeometry {
    readonly width:  string;
    readonly height: string;

    /**
     * The document's OWN margins, as CSS lengths, or absent for Word's default.
     *
     * The canvas used to write on a fixed 20mm frame whatever the file said, so
     * a document with one-inch margins paginated on screen against a writing
     * width 9mm wider than the one the .docx gives it -- a difference that is
     * nothing on a page and a whole line by the end of a long one. Absent still
     * means 20mm, because page content and templates have no margins to state
     * and their pagination must not move.
     */
    readonly margins?: PageMargins;
}

/** The four sides of the writing frame, as CSS lengths. */
export interface PageMargins {
    readonly top:    string;
    readonly right:  string;
    readonly bottom: string;
    readonly left:   string;
}

/** Breathing room either side of the sheet when it is scaled to fit. */
const SHEET_GUTTER_PX = 32;


/** Workspace visible between two sheets — the gap that makes them two. */
const SHEET_GAP_PX = 24;

/**
 * The paged canvas writes in the DOCUMENT's font, not the interface's.
 *
 * Carlito is metric-compatible with Calibri, Word's default, and is the same
 * file the engine measures and the renderer embeds. Three copies of one font
 * is what makes the page boundaries on screen the boundaries in the .docx; a
 * UI font here would look tidy and paginate differently.
 */
const DOCUMENT_FONT_FAMILY = 'Carlito';

/** 11pt, Word's default body size, in the millimetre-free unit CSS wants. */
const DOCUMENT_FONT_SIZE = '11pt';

/** Word's default margin, and the padding the writing column already uses. */
const PAGE_MARGIN = '20mm';

/**
 * The frame a document that states no margins is written on.
 *
 *  The ONE place `20mm` is written. It used to appear three times -- this
 * constant, the sheet's `padding`, and the page break's full-bleed negative
 * margin -- which is fine until a document brings margins of its own and only
 * two of the three learn about them. All three now read the custom properties
 * `applyGeometry()` writes, and this is what they hold when the host hands over
 * no margins.
 */
const DEFAULT_PAGE_MARGINS: PageMargins = {
    top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN,
};

/** The custom property each side's margin rides on, for the sheet CSS. */
const PAGE_MARGIN_PROPERTIES: Readonly<Record<keyof PageMargins, string>> = {
    top: '--cms-page-margin-top',
    right: '--cms-page-margin-right',
    bottom: '--cms-page-margin-bottom',
    left: '--cms-page-margin-left',
};

/**
 * The frame this paper is written on: the document's own margins, or Word's
 * default when it states none.
 *
 *  The ONE place that fallback happens. The sheet's padding and the
 * paginator's measurements both come through here, and a document that got its
 * own margins in one and the default in the other would be laid out by the
 * browser to a width the engine did not measure — which is a line that fits on
 * screen and not in the file, once per page, compounding.
 */
export function pageMarginsOf(geometry: PageGeometry): PageMargins {
    return geometry.margins ?? DEFAULT_PAGE_MARGINS;
}

/**
 * Public component that mounts a Tiptap editor and renders the toolbar
 * declared by the backend's editor manifest. Component contract:
 *
 *   profile           required — names the profile (manifest key). Mirrors
 *                     PHP `EditorProfile` resolution: 'simple', 'standard',
 *                     'full', 'admin', 'comment', or any custom YAML.
 *   content (model)   two-way bound editor content. The component owns the
 *                     storage shape via `contentAdapter` (default: HTML
 *                     identity) so consumers can pass dtmpl, markdown, etc.
 *   contentAdapter    optional storage adapter; identity HTML when null.
 *
 * The toolbar reads `manifestProvider.getProfile(profile)`, resolves Tiptap
 * extensions via `EditorExtensionRegistry`, mounts a Tiptap instance, and
 * dispatches button clicks through `EditorActionRegistry`. Per-action
 * context carries `allowedWidgets` so handlers can check policy alongside
 * the toolbar's profile-driven filter.
 *
 * Source mode is component-owned: the toolbar's `editor.toggleSourceMode`
 * handler calls back into this component to swap the Tiptap mount for a
 * `<textarea>` showing the storage form.
 */
@Component({
    selector: 'coolms-editor',
    standalone: true,
    // The loader keeps its OWN (emulated) encapsulation despite this component
    // turning encapsulation off — its styles stay scoped to itself, which is
    // what lets it be dropped into surfaces that know nothing about each other.
    imports: [CmsLoaderComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    /**
     * `ViewEncapsulation.None` is required: the editor renders content via
     * Tiptap NodeViews (gridColumn resize chip, formField chip) that create
     * DOM imperatively. Imperative DOM doesn't carry the `_ngcontent-…`
     * attribute Emulated encapsulation depends on, so any rule targeting
     * NodeView-rendered classes (`.cms-grid-column`, etc.) silently failed
     * to match. Styles below are still effectively scoped because every
     * descendant selector is anchored to `.cms-editor__mount`, a class only
     * the editor's own template emits.
     */
    encapsulation: ViewEncapsulation.None,
    // Paged mode is a HOST class, not a wrapper element: with encapsulation
    // off, one class on the host gates every sheet rule below without adding a
    // box that the split-preview layout would then have to flatten too.
    host: { '[class.cms-editor--paged]': 'paged()' },
    template: `
        <div class="cms-editor">
            <div class="cms-editor__toolbar" role="toolbar" aria-label="Editor toolbar">
                <!-- ONE list, so the font pickers sit where the order says
 rather than always last. See ToolbarSlot. -->
                @for (slot of toolbarSlots(); track slot.key) {
                    @if ('nodes' === slot.kind) {
                        <div class="cms-editor__toolbar-group">
                            @for (node of slot.nodes; track node.id) {
                                <button type="button"
                                        class="cms-editor__btn"
                                        [class.cms-editor__btn--active]="isActive(node)"
                                        [disabled]="sourceMode() && node.id !== 'meta:source'"
                                        [title]="tooltip(node)"
                                        [attr.aria-label]="translateLabel(node.label)"
                                        (click)="dispatch(node, $event)">
                                    <i [class]="'bi ' + node.icon"></i>
                                </button>
                            }
                        </div>
                    } @else {
                    <div class="cms-editor__toolbar-group" role="group" aria-label="Font">
                        <select class="cms-editor__font"
                                aria-label="Font family"
                                (change)="setFontFamily($any($event.target).value)">
                            <option value="" [selected]="!fontFamily()">Default</option>
                            @for (family of fontFamilies(); track family) {
                                <option [value]="family" [selected]="fontFamily() === family">{{ family }}</option>
                            }
                        </select>
                        <input class="cms-editor__fontsize"
                               type="number" min="1" max="409" step="0.5"
                               placeholder="pt"
                               aria-label="Font size in points"
                               [value]="fontSize()"
                               (change)="setFontSize($any($event.target).value)" />
                        <input class="cms-editor__fontcolor"
                               type="color"
                               title="Text colour"
                               aria-label="Text colour"
                               [value]="fontColor() || '#000000'"
                               (change)="setFontColor($any($event.target).value)" />
                        <input class="cms-editor__fontcolor cms-editor__highlight"
                               type="color"
                               title="Highlight"
                               aria-label="Highlight colour"
                               [value]="fontHighlight() || '#ffff00'"
                               (change)="setFontHighlight($any($event.target).value)" />
                        <!-- A colour input cannot report "none", so removing a
                             font or a highlight needs its own control. -->
                        <button type="button"
                                class="cms-editor__btn"
                                title="Clear font"
                                (click)="clearFont()">
                            <i class="bi bi-eraser"></i>
                        </button>
                    </div>
                    }
                }

            </div>

            @if (sourceMode()) {
                <textarea class="cms-editor__source"
                          [value]="content()"
                          (input)="onSourceInput($any($event.target).value)"
                          spellcheck="false"></textarea>
            } @else {
                <!-- The SCROLLER is the outer box; the mount is the canvas that
                     grows with the zoomed page. Splitting them is what lets the
                     desk padding survive on all four sides and what gives the
                     sheet layer a containing block as wide as the CONTENT
 rather than as wide as the window. -->
                <div class="cms-editor__scroll" (wheel)="onWheelZoom($event)">
                    <div #editorMount class="cms-editor__mount"
                         [class.cms-editor__mount--settling]="paged() && !canvasReady()"></div>
                    <!-- Covers the canvas until the first pagination lands.
                         Tiptap paints the whole document as ONE column the
                         instant it mounts, so without this the author sees the
                         text unsplit and then watches it jump onto its pages
                         once the fonts arrive and the engine runs. -->
                </div>
            }

            <!-- The status bar: the two VIEW controls, under the canvas they
                 act on. Where the page counter and the zoom live in every
                 office application, and where the sheet editor already keeps
 its own -- the two surfaces now agree, which is what
                 the author asked for. They were the last two things in a
                 formatting toolbar they were not part of. -->
            @if (paged() && !sourceMode()) {
                <div class="cms-editor__statusbar">
                    <div class="cms-editor__pager" role="group" aria-label="Page navigation">
                        <button type="button"
                                class="cms-editor__btn"
                                title="Previous page"
                                [disabled]="currentPage() <= 1"
                                (click)="goToPage(currentPage() - 1)">
                            <i class="bi bi-chevron-up"></i>
                        </button>
                        <span class="cms-editor__pager-label">
                            Page {{ currentPage() }} of {{ pageCount() }}
                        </span>
                        <button type="button"
                                class="cms-editor__btn"
                                title="Next page"
                                [disabled]="currentPage() >= pageCount()"
                                (click)="goToPage(currentPage() + 1)">
                            <i class="bi bi-chevron-down"></i>
                        </button>
                    </div>
                    <div class="cms-editor__zoom" role="group" aria-label="Zoom">
                        <button type="button" class="cms-editor__btn" title="Zoom out" (click)="zoomBy(1 / 1.1)">
                            <i class="bi bi-zoom-out"></i>
                        </button>
                        <!-- A SELECT, not a readout: stepping by 10% can pass
                             100% without landing on it, and "make it actual
                             size" is the one zoom an author asks for by name.
                             Per-OPTION selection for the same reason the format
                             pickers use it -- a [value] binding resolves before
                             @for has attached the options. -->
                        <select class="cms-editor__zoom-select"
                                aria-label="Zoom"
                                (change)="setZoomChoice($any($event.target).value)">
                            <option value="fit" [selected]="isZoomFitted()">Fit</option>
                            @for (step of zoomSteps; track step) {
                                <option [value]="step"
                                        [selected]="!isZoomFitted() && zoomPercent() === step">{{ step }}%</option>
                            }
                            @if (isZoomCustom()) {
                                <!-- Ctrl+wheel lands between the steps; showing
                                     the real number beats snapping the author's
                                     zoom to the nearest one behind their back. -->
                                <option [value]="zoomPercent()" [selected]="true">{{ zoomPercent() }}%</option>
                            }
                        </select>
                        <button type="button" class="cms-editor__btn" title="Zoom in" (click)="zoomBy(1.1)">
                            <i class="bi bi-zoom-in"></i>
                        </button>
                    </div>
                </div>
            }

            <!-- Same caption as the dialog's fetch phase on purpose. These are
                 two components in two parts of the tree, so the mark is
                 remounted between them; matching the words means the only thing
                 that changes across the handover is which element is drawing it,
                 and the wait reads as one. A more precise "Laying out the
                 document" here was accurate and looked like a second load
                 starting.
                 ⚠️ A SIBLING OF THE TOOLBAR, not a child of the scroller, and
 that is the whole of the jitter it caused. The host's loader fills the
                 dialog body; this one used to fill only the scrolling area
                 BELOW the toolbar, so the two marks were centred on boxes about
                 a toolbar's height apart and the glyph visibly hopped as the
                 owner changed. Covering the toolbar as well is also the honest
                 reading of the state: nothing on it can be used yet. -->
            @if (paged() && !canvasReady()) {
                <cms-loader [overlay]="true" label="Opening the document" />
            }
        </div>
    `,
    styles: [`
        /* Host establishes a flex column that fills its parent — when the
         * parent is itself a bounded flex container (page-editor dialog
         * body), the editor expands to fill it; when the parent is a
         * regular block (RichTextFieldComponent in a form layout), flex:1
         * is a no-op and the inner mount's min-height keeps the editor
         * usable at a fixed reasonable size. With ViewEncapsulation.None,
         * the :host pseudo no longer applies — the component selector
         * matches the host element directly. */
        coolms-editor {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
        }
        .cms-editor {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius);
            background: var(--cms-surface);
            /* The containing block for the settling cover, which now spans the
               toolbar too so it lines up with the host's own loader. */
            position: relative;
        }
        .cms-editor__toolbar {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 6px 8px;
            border-bottom: 1px solid var(--cms-border);
            background: var(--cms-bg);
            flex-wrap: wrap;
            /* Toolbar height is content-driven; the mount below claims the
             * remaining space via flex:1. */
            flex: 0 0 auto;
            /* ...but CAPPED, because content-driven had no ceiling. Measured in
             * a 520px viewport: four groups became three rows at 105px, and in
             * a short pane (split preview, a dialog) that is a large share of
             * the editor — the toolbar growing at the writing area's expense.
             * Roughly three rows, then it scrolls: an author who needs a rare
             * button can reach it, and the page they are writing keeps the
             * space. */
            max-height: 7.5rem;
            overflow-y: auto;
        }
        .cms-editor__toolbar-group {
            display: inline-flex;
            gap: 2px;
            padding: 0 4px;
            border-right: 1px solid var(--cms-border);
            /* A group is ATOMIC: it wraps to the next row whole rather than
             * being squashed, so related buttons stay together. Without this a
             * group shrinks below its content and the buttons inside it are
             * compressed one by one — the behaviour that reads as "single
             * elements wrap". */
            flex-shrink: 0;
            /* The one exception, and it is a last resort: a group WIDER than
             * the toolbar cannot wrap as a unit anywhere. Measured at a 466px
             * toolbar, the 18-button group was 547px and OVERFLOWED — its last
             * buttons rendered outside the box, unreachable. Wrapping inside
             * the group is worse than keeping it whole and better than losing
             * the buttons, so it is what happens only when nothing else can.
             *
             * The max-width below is what MAKES that work, and the pair is easy
             * to get wrong: flex-shrink 0 holds the group at its max-content
             * width, so flex-wrap alone has no constraint to react to and the
             * group overflows exactly as before. Capping it at the toolbar's
             * width gives the wrap something to bite on — measured, the first
             * attempt without this changed nothing at all. */
            flex-wrap: wrap;
            max-width: 100%;
        }
        .cms-editor__toolbar-group:last-child { border-right: none; }
        .cms-editor__font, .cms-editor__fontsize {
            height: 28px;
            padding: 0 4px;
            font-size: .8125rem;
            color: var(--cms-text);
            background: var(--cms-input-bg);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
        }
        .cms-editor__font { max-width: 8rem; }
        /* Wider than a 28px icon button because it holds up to four characters,
           and monospaced so the toolbar does not shift as the number changes. */
        .cms-editor__zoom-select {
            height: 28px;
            padding: 0 4px;
            font-size: .75rem;
            font-variant-numeric: tabular-nums;
            color: var(--cms-text);
            background: var(--cms-input-bg);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
        }
        .cms-editor__fontsize { width: 3.75rem; }
        /* Stripped back to the swatch: a colour input paints its own chrome in
           every browser and would tower over the 28px buttons beside it. */
        .cms-editor__fontcolor {
            width: 28px; height: 28px; padding: 0;
            background: none; cursor: pointer;
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm);
        }
        .cms-editor__fontcolor::-webkit-color-swatch-wrapper { padding: 2px; }
        .cms-editor__fontcolor::-webkit-color-swatch { border: 0; border-radius: 2px; }
        .cms-editor__btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            padding: 0;
            background: transparent;
            border: 1px solid transparent;
            border-radius: var(--cms-radius-sm);
            color: var(--cms-text-secondary);
            cursor: pointer;
            font-size: .875rem;
            transition: background .1s, color .1s, border-color .1s;
        }
        .cms-editor__btn:hover:not(:disabled) {
            background: var(--cms-border-light);
            color: var(--cms-text);
        }
        .cms-editor__btn:disabled { opacity: .45; cursor: not-allowed; }
        .cms-editor__btn--active {
            background: var(--cms-accent-light);
            color: var(--cms-accent-text);
            border-color: var(--cms-accent);
        }
        .cms-editor__mount,
        .cms-editor__source {
            /* flex:1 lets us claim every remaining pixel from the host's
             * column. min-height:200px is the fallback so the editor stays
             * usable even when the parent doesn't bound height (compact
             * dynamic-form fields rendered through RichTextFieldComponent). */
            flex: 1;
            min-height: 200px;
            padding: 12px 16px;
            font-size: .9375rem;
            line-height: 1.6;
            overflow-y: auto;
        }
        .cms-editor__source {
            border: none;
            outline: none;
            font-family: var(--cms-font-mono, monospace);
            background: var(--cms-surface);
            color: var(--cms-text);
            /* Match the visual mount: scroll inside, no manual resize handle
             * (the host's flex layout already governs vertical sizing). */
            resize: none;
            width: 100%;
            box-sizing: border-box;
        }
        /* Positioned ancestor for the drag handle, which the DragHandleController
         * appends to this element and places in the left padding gutter. */
        .cms-editor__mount { position: relative; }
        /* Invisible to layout unless the canvas is PAGED: the inline editor
           keeps the mount as a direct flex child of the column exactly as
           before, so wrapping it costs that mode nothing. */
        .cms-editor__scroll { display: contents; }
        /* Hidden rather than merely covered: the loader's own surface would sit
           over it, but a transparent canvas underneath still shows through the
           dialog's edges while the document reflows. Visibility keeps the box
           in the layout so the pagination measures the real geometry — display
           none would give it a zero-height surface to paginate. */
        .cms-editor__mount--settling { visibility: hidden; }

        /* -- Page navigator ------------------------------------------
         * Pushed to the far end of the toolbar row: it is a readout about the
         * document, not another formatting control, and mixing it into the
         * button groups makes it look like one. */
        .cms-editor__pager {
            display: flex;
            align-items: center;
            gap: 2px;
        }
        /* Mirrors the toolbar it no longer lives in -- same button metrics,
           same muted text -- but bordered on TOP, because it belongs to the
           canvas above it rather than to the dialog chrome below. */
        .cms-editor__statusbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 4px 8px;
            border-top: 1px solid var(--cms-border);
            background: var(--cms-bg);
            flex: 0 0 auto;
        }
        .cms-editor__zoom {
            display: flex;
            align-items: center;
            gap: 2px;
        }
        .cms-editor__pager-label {
            font-size: .8125rem;
            color: var(--cms-text-muted);
            white-space: nowrap;
            padding: 0 4px;
        }

        /* -- Paged canvas: the "Word look" ---------------------------
         * Gated on the host class, so every other editor surface is untouched.
         * The mount stops being the writing surface and becomes the WORKSPACE
         * the sheet sits on — hence the grey background and the symmetric
         * gutter replacing its text padding. */
        .cms-editor--paged .cms-editor__mount {
            /* The workspace, not the writing surface. Darker than the sheet on
             * purpose: if the two differ by too little the page edge reads as a
             * rendering artefact rather than as paper.
             *
             * Was the literal #e4e6ea, which --cms-desk still resolves to in
             * light mode; the token exists so the desk can go dark while the
             * paper stays white. NO BACKTICKS IN HERE.
             *
 * The colour itself moved to .cms-editor__scroll — the
             * mount is now only as tall as its content, so a desk painted here
             * would stop short of the pane whenever the document is short. */
            /* Was 20px 0 — vertical only, so the page ran edge to edge and read
             * as BEING the editor rather than as paper lying on a desk. A word
             * processor shows desk on all four sides; without the side gutters
             * the top gap alone looks like a rendering gap rather than a
             * margin, which is what "the top indent is missing" was describing.
             * fitSheet() subtracts this, or the zoom would size the page to a
             * width the padding does not leave it.
             *
             * Held in a variable because the SHEET LAYER has to match it — see
             * .cms-editor__sheets below. Two literals would drift and the paper
             * would part company with its own text. */
            --cms-desk-pad-y: 32px;
            padding: var(--cms-desk-pad-y) 24px;
        }
        .cms-editor--paged .cms-editor__mount .ProseMirror {
            width: var(--cms-page-width);
            min-height: var(--cms-page-height);
            /* Shrink to fit the pane, never magnify (see fitSheet()). zoom
             * rather than a scale transform: zoom scales the LAYOUT, so the
             * workspace keeps the right scroll height and the caret keeps
             * landing where it is drawn — a transform leaves the untransformed
             * box behind and both of those go wrong.
             * NO BACKTICKS IN HERE: this is a JS template literal. */
            zoom: var(--cms-page-zoom, 1);
            /* The DOCUMENT's own margins, written to the host by the geometry
             * effect and defaulting to Word's 20mm there. This is the reason
             * the sheet is measured in millimetres rather than pixels: the
             * width an author writes to is the width the .docx gives them, and
             * a fixed frame made that true for one margin setting only. */
            padding: var(--cms-page-margin-top) var(--cms-page-margin-right)
                     var(--cms-page-margin-bottom) var(--cms-page-margin-left);
            margin: 0 auto;
            box-sizing: border-box;
            /* TRANSPARENT. This column used to BE the sheet, which
             * is why three pages of content drew one endless page with grey
             * bars across it — the break was decoration on a single sheet that
             * simply kept growing. The paper is now a stack of real boxes
             * behind the text (.cms-editor__sheet), one per page, and a break
             * stretches to push what follows onto the next one. */
            background: transparent;
            box-shadow: none;
            position: relative;
            z-index: 1;
            /* Both numbers are set by repaginate() from the FONT FILE, so the
             * line height the browser uses is the one the engine computed.
             * Leaving it to 'normal' lets the browser pick from a different
             * metric table, and the two disagree by a fraction that becomes a
             * whole line somewhere down a long document. */
            /* Registered at runtime from the same bytes the engine measures
             * (see pagination/document-fonts.ts) under EVERY name the manifest
             * substitutes -- so both names below paint the vendored face, and a
             * machine with its own Carlito or its own Calibri still gets ours.
             * NO BACKTICKS IN HERE: this is a JS template literal. */
            font-family: Carlito, Calibri, sans-serif;
            font-size: var(--cms-doc-size, 11pt);
            line-height: var(--cms-doc-line, normal);
            /* A faux bold has different advance widths than the real bold
             * face, so the measurement would describe a font nobody sees. */
            font-synthesis: none;
        }

        /* The line box the ENGINE computed, drawn.
         *
         * Set per block by repaginate(), which is also what puts the attribute
         * there -- so this reaches exactly the blocks whose number the engine
         * produced and nothing else. A table cell's paragraphs are not among
         * them yet and keep what they had.
         *
         * MEASURED with tools/line-box-probe.html at 11pt, px, against the
         * engine's max(ascender+lineGap) + max(-descender):
         *
         *     treatment                       Carlito  Carlito+Mono  Serif+Mono
         *     engine                           17.904       18.369      18.097
         *     line-height: normal (before)     17.600       18.400      18.400
         *     H on the block only              17.900       19.975      19.700
         *     H on block AND runs              17.900       19.975      19.700
         *     runs at 0, block at H            17.900       18.375      18.100
         *
         * The zeroing is the whole trick, and it is not a hack. CSS gives every
         * inline box the stated height by splitting the leading HALF above and
         * HALF below ITS OWN content area, so two faces on one line sit at
         * different offsets and their union is ~1.6px taller than either.
         * Zeroing the runs takes them out of that union and leaves the block's
         * own strut, which is exactly H.
         *
         * Glyphs still paint outside a zero-height inline box -- that is normal
         * inline overflow -- and they cannot collide, because H is by
         * construction tall enough for the tallest face on the line.
         *
         * The caret is unaffected: Chrome measures a Range from the text's
         * CONTENT AREA, not from its inline box. Measured at 16.800px either
         * way. NO BACKTICKS IN HERE: this is a JS template literal. */
        .ProseMirror [data-cms-line-box] {
            line-height: var(--cms-line-box);
        }
        /* Every DESCENDANT, though inheritance would carry it anyway: a bold
         * run is a span inside a strong, and stating it once here is cheaper to
         * read than a rule that relies on the cascade to reach the inner one. */
        .ProseMirror [data-cms-line-box] * {
            line-height: 0;
        }
        /* ...except the page gap, which is a BLOCK widget inside the paragraph
         * it splits. Zeroing it would collapse the thing whose whole job is to
         * be a measured height. */
        .ProseMirror [data-cms-line-box] .cms-page-gap {
            line-height: normal;
        }

        /* The page gap: what pushes the content that overran a page onto the
         * next one. A ProseMirror widget decoration, so it is never part of the
         * document, never copied, and never somewhere the caret can land.
         * display:block is what makes it split a PARAGRAPH -- the line ends at
         * the gap and the rest of the text continues below it.
         *
         *  TWO shapes, because a table cannot hold the first one. Between
         * two rows a block is hoisted out of the table by the parser, and a
         * block inside one CELL grows that cell alone. So inside a table the
         * gap IS a row. */
        .cms-editor--paged .cms-editor__mount .ProseMirror .cms-page-gap {
            pointer-events: none;
            user-select: none;
        }
        .cms-editor--paged .cms-editor__mount .ProseMirror div.cms-page-gap {
            display: block;
            width: 100%;
        }
        /* Inside a table the gap is a ROW, and its height lives on the cell.
         * The cell has to lose everything an authored cell has -- the dashed
         * border, the padding and the 32px floor -- or the gap would draw a
         * box in the seam and could never be shorter than that floor.
         * NO BACKTICKS IN HERE: this is a JS template literal. */
        .cms-editor--paged .cms-editor__mount .ProseMirror tr.cms-page-gap > td {
            border: 0;
            padding: 0;
            min-width: 0;
            min-height: 0;
        }

        /* The paper. Absolutely positioned inside the scrolling mount so it
         * scrolls with the text, and zoomed identically so both layers share
         * one coordinate system — repaginate() measures in the text's space
         * and positions in this one. */
        .cms-editor--paged .cms-editor__sheets {
            position: absolute;
            /* The paper has to start where the TEXT starts. This layer is
             * absolutely positioned, so it resolves against the mount's PADDING
             * BOX and ignored the desk padding the ProseMirror obeys — leaving
             * the sheets sitting a padding's worth ABOVE their own text. The
             * white page then touched the toolbar, which is what "the top
             * indent is missing" looked like, and every line sat that far too
             * low inside its page.
             *
             * Divided by the zoom because this element CARRIES the zoom: an
             * offset written here is scaled with everything else, so a plain
             * 32px would land at 32 x zoom and only line up at 100%. */
            top: calc(var(--cms-desk-pad-y, 0px) / var(--cms-page-zoom, 1));
            left: 0;
            right: 0;
            z-index: 0;
            pointer-events: none;
            zoom: var(--cms-page-zoom, 1);
        }
        .cms-editor--paged .cms-editor__sheet {
            position: absolute;
            left: 50%;
            margin-left: calc(var(--cms-page-width) / -2);
            width: var(--cms-page-width);
            /* PAPER, not a themed surface. This was --cms-surface, which was
             * white when there was one theme and navy the moment dark mode
             * shipped: the page vanished into the workspace and the document
             * could not be read. NO BACKTICKS IN HERE. */
            background: var(--cms-paper);
            box-shadow: 0 1px 4px rgba(0, 0, 0, .18);
        }
        /* The body text sits ON that paper, so it takes the paper's foreground
         * rather than the admin's --cms-text, which inverts with the theme. */
        .cms-editor--paged .cms-editor__mount .ProseMirror {
            color: var(--cms-paper-text);
        }
        /* A footnote marker shows the note's POSITION, not its id.
         *
         * The id is a KEY, and every reader prints the position -- measured in
 * An earlier fix, where LibreOffice pairing the two .docx parts by position was
         * swapping note bodies outright. A counter is always right and costs no
         * JavaScript: the browser recomputes it on every edit, including one
         * made in a table cell or three pages away.
         *
         * The id stays in the markup as the element's text, because that is
         * what the writer emits and a round trip should not change shape --
         * so it is zeroed here and the number comes from the counter. The
         * pseudo-element states an ABSOLUTE size for exactly that reason: an
         * em of a zeroed font size is zero.
         * NO BACKTICKS IN HERE: this is a JS template literal. */
        .cms-editor__mount .ProseMirror { counter-reset: cms-footnote; }
        .cms-editor__mount .ProseMirror sup[data-footnote] {
            counter-increment: cms-footnote;
            font-size: 0;
        }
        .cms-editor__mount .ProseMirror sup[data-footnote]::before {
            content: counter(cms-footnote);
            font-size: .7rem;
        }
        /* The mount's own scrollbar is the workspace scrollbar now; keep the
         * sheet from being clipped when the paper is wider than the pane. */
        /* The SCROLLER owns the overflow and the desk; the mount owns the
           padding and grows with the page. Splitting them fixes three things at
 once: a scroll container's padding-right and padding-bottom
           are not honoured for overflowing content, so the desk vanished on
           those sides the moment the page was zoomed past the pane — and an
           absolutely-positioned layer resolves against the CLIENT box, so the
           sheets centred on the window while the text centred on the content
           and the two drifted apart by hundreds of pixels at high zoom. */
        .cms-editor--paged .cms-editor__scroll {
            display: flex;
            flex-direction: column;
            /* The loader overlays THIS box, so it has to be the positioned
               ancestor — otherwise it would cover the whole editor including
               the toolbar. */
            position: relative;
            flex: 1;
            min-height: 200px;
            overflow: auto;
            /*  Load-bearing since the fit began MAGNIFYING. The fit is
               computed from this box's clientWidth, and a scrollbar that comes
               and goes changes that by ~15px -- so a page scaled to fill can
               summon the scrollbar, which narrows the pane, which shrinks the
               page, which dismisses the scrollbar, forever. Reserving the
               gutter on BOTH edges takes the scrollbar out of the measurement
               and keeps the sheet centred while it is there. */
            scrollbar-gutter: stable both-edges;
            background: var(--cms-desk);
        }
        .cms-editor--paged .cms-editor__mount {
            flex: none;
            overflow: visible;
            /* Grows to the zoomed page plus its desk, never narrower than the
               pane — which is what makes the padding real on every side and
               gives the sheet layer a full-content-width containing block. */
            width: max-content;
            min-width: 100%;
            box-sizing: border-box;
            background: transparent;
        }

        /* On paper a break is not something you SEE — it is the reason the next
         * paragraph is on the next sheet. So it draws nothing: repaginate()
         * gives it exactly the height needed to fill out the current page, clear
         * the gap, and land the following content inside the next page's top
         * margin. Full-bleed negative margins so that height spans the paper. */
        /* Specificity note, NO BACKTICKS IN HERE (this is a JS template
         * literal): the base look is written three classes deep, under the
         * mount and the ProseMirror surface. A two-class paged override loses
         * to it, which is why the dashed rule stayed on the paper. Match the
         * depth rather than reach for !important. */
        .cms-editor--paged .cms-editor__mount .ProseMirror .cms-page-break {
            /* Zero height. The engine treats an explicit break as
             * an instruction about the block that follows, not as content, so
             * anything this element occupied would be space the engine did not
             * account for — and every page after it would drift. */
            height: 0;
            overflow: hidden;
            /* Full bleed: the break's height has to span the PAPER, so it
             * cancels whatever side margins the document states. */
            margin: 0 calc(var(--cms-page-margin-right) * -1)
                    0 calc(var(--cms-page-margin-left) * -1);
            border-top: none;
            background: transparent;
            box-shadow: none;
            /* Replaced per break by repaginate(); this is only what a break
             * looks like for the instant before the first measurement. */
            height: 24px;
            /* A stretched break is most of a page tall, which made it a huge
             * invisible click target: clicking the empty lower half of a page
             * selected the break and drew an outline round the whole thing,
             * with no way to tell what had been selected. The rest of a page is
             * paper, so clicks belong to the text underneath. Removing it stays
             * possible from the keyboard — Backspace at the top of the next
             * page — which is how a word processor does it anyway. */
            pointer-events: none;
        }
        .cms-editor--paged .cms-page-break__label {
            /* Kept for the selected state only — an always-on "PAGE BREAK"
             * caption is exactly the chrome that made the old canvas read as a
             * web page with dividers rather than as paper. */
            display: none;
        }
        /* Selected (only reachable from the keyboard now): mark the SEAM, not
         * the whole stretched box. An outline round the full height reads as
         * "most of this page is selected", which is what the user saw and
         * could not identify. */
        .cms-editor--paged .cms-editor__mount .ProseMirror .cms-page-break.ProseMirror-selectednode {
            outline: none;
        }
        .cms-editor--paged .cms-page-break.ProseMirror-selectednode .cms-page-break__label {
            display: block;
            top: auto;
            bottom: 6px;
            background: transparent;
            color: var(--cms-accent);
        }
        .cms-editor--paged .cms-page-break.ProseMirror-selectednode {
            outline: 2px solid var(--cms-accent);
            outline-offset: -2px;
        }
 /* Drag-to-reorder handle. Lives in the mount's left padding
         * so it never overlaps prose; the controller toggles display + top as
         * the pointer moves between top-level blocks. */
        .cms-drag-handle {
            position: absolute;
            left: 0;
            width: 16px;
            height: 24px;
            align-items: center;
            justify-content: center;
            color: var(--cms-text-muted);
            cursor: grab;
            border-radius: var(--cms-radius-sm, 4px);
            opacity: .5;
            user-select: none;
            z-index: 3;
            font-size: .9rem;
            transition: opacity .12s, background .12s, color .12s;
        }
        .cms-drag-handle:hover { opacity: 1; background: var(--cms-border-light); color: var(--cms-text); }
        .cms-drag-handle:active { cursor: grabbing; }
        .cms-editor__mount .ProseMirror {
            outline: none;
            min-height: 100%;

            /* The mount is the scroll viewport and carries the vertical padding,
             * but the ProseMirror itself has none — so the FIRST block's top
             * margin (e.g. an h1's .8em) collapses out of the ProseMirror and
             * stacks ON TOP of its min-height:100% box, overflowing the mount by
             * exactly that margin and showing a permanent scrollbar (tall thumb)
             * even for one-line content. Zero the first/last block margins so the
             * fill-height box matches the viewport exactly. */
            > :first-child { margin-top: 0; }
            > :last-child { margin-bottom: 0; }

            /* The gap cursor's own stylesheet, which neither the Tiptap
               extension nor prosemirror-gapcursor injects — the CSS file ships
               beside the package and has to be asked for.
               Without it the caret POSITION works and nothing draws, so the
               author arrows into a place they cannot see and types blind, which
 is barely better than the dead end it fixes.
               Recoloured from the upstream hard-coded black to the text token,
               or it is invisible against the dark theme's paper. */
            .ProseMirror-gapcursor {
                display: none;
                pointer-events: none;
                position: absolute;
            }
            .ProseMirror-gapcursor::after {
                content: "";
                display: block;
                position: absolute;
                top: -2px;
                /*  currentColor, NOT a --cms-* token, and that is the whole of
 the follow-up. I themed this with --cms-text and it
                   was wrong: that is the admin CHROME's text colour, and the
                   paged canvas is PAPER. Measured in dark mode the caret came
                   out rgb(232,237,244) on a sheet that stays rgb(255,255,255) —
                   about 1.05:1, invisible — while the document's own text sat at
                   rgb(17,24,39). currentColor inherits the surface's colour, so
                   the caret is always the colour of the text it is about to
                   insert, on paper and in an inline profile alike. Right by
                   construction rather than by picking the correct token.
                   Wider and thicker than upstream's 20px hairline on purpose:
                   at 1px it reads as a RULE, and it sits two pixels off a
                   table's 1px dashed border, which is exactly the confusion
                   reported. In em so it tracks the document size. */
                width: 2.5em;
                border-top: 2px solid currentColor;
                animation: cms-gapcursor-blink 1.1s steps(2, start) infinite;
            }
            @keyframes cms-gapcursor-blink { to { visibility: hidden; } }
            /* The blink is what makes it read as a caret rather than a stray
               line, so it stays — but motion is a preference, and a static bar
               still says "here". Same call the loader makes. */
            @media (prefers-reduced-motion: reduce) {
                .ProseMirror-gapcursor::after { animation: none; }
            }
            &.ProseMirror-focused .ProseMirror-gapcursor { display: block; }

            p { margin: 0 0 .75em; }
            /* Points, not rem: this is PAPER, and rem is anchored to the admin
             * chrome's root size. A user scaling the UI would otherwise rescale
             * the headings on the canvas while the generated .docx kept its own
             * — the canvas would stop being a preview. These are the same sizes
             * the rem values resolved to (18/15/13.5pt), so nothing shifts, and
             * they now read directly against DocxComposer::HEADING_STYLES.
             *
             *  The line height is STATED, and that is the whole of this note.
             * The admin chrome's own stylesheet carries a rule for h1..h6 with
             * line-height 1.2, and it reached the paper because these rules
             * named every other property and not that one. MEASURED
             * 2026-08-24: an 18pt heading drew on a 21.60pt line where
             * LibreOffice printed it on 22.00, the face's own 1.2207 -- the
             * chrome deciding how tall a line of the DOCUMENT is. The same
             * failure as the rem note above, in a different property.
             * NO BACKTICKS IN HERE: this is a JS template literal.
             *
             * "normal" and not a number: it means the FACE's natural line, so
             * the browser and the engine reach the same answer out of the same
             * font file -- measureBoxAt() reads normal as "no length" and lets
             * the engine use the metric it has already loaded. A number here
             * would be a third opinion about what Carlito is. */
            h1 { font-size: 18pt; font-weight: 700; margin: .8em 0 .4em; line-height: normal; }
            h2 { font-size: 15pt; font-weight: 700; margin: .8em 0 .4em; line-height: normal; }
            h3 { font-size: 13.5pt; font-weight: 600; margin: .8em 0 .4em; line-height: normal; }
            ul, ol { padding-left: 1.5em; margin: 0 0 .75em; }
            /*  These sit on --cms-paper, which is #ffffff in BOTH themes, so
               they take the paper family's inks and not the chrome's. The link
               was --cms-accent: theme-invariant amber, and therefore 2.03 on
               this paper in both themes -- below even the 3:1 for non-text.
               The quote was --cms-text-muted, which DOES vary, drawing ~3.3
               light and ~4.2 dark on the same white. An invariant surface
               needs invariant ink. Now 7.20 and 4.83. */
            blockquote { border-left: 3px solid var(--cms-border); margin: 0 0 .75em; padding-left: 1em; color: var(--cms-paper-muted); }
            a { color: var(--cms-paper-link); text-decoration: underline; }

            /* gridLayout editor visuals. Self-contained so the editor renders
             * correctly regardless of the host theme's Bootstrap state
             * (col-N percentages live here, flex layout is forced with
             * !important so an unrelated theme rule can't collapse columns
             * into a vertical stack). Colour hierarchy follows Word/Docs
             * convention: gray dashed for structural hints, CMS orange for
             * hover/focus indication. None of these styles leak past the
             * .cms-editor__mount scope, so production rendering of the same
             * HTML uses the host theme's grid stylesheet (Bootstrap)
             * untouched. */

            /* Outer wrapper: subtle solid border + faint tint so authors
             * see "this block is a grid" at a glance. */
            .cms-grid {
                padding: 6px;
                margin: .5em 0 .75em;
                border: 1px solid rgba(0, 0, 0, .08);
                border-radius: var(--cms-radius-sm, 4px);
                background: rgba(0, 0, 0, .01);
            }

            /* Row separator: dashed bottom border between stacked rows so
             * multi-row grids show row boundaries. flex !important guards
             * the horizontal layout against any host stylesheet that might
             * unset display on .row. */
            .cms-grid .row {
                display: flex !important;
                flex-wrap: wrap;
                margin: 0;
                padding: 4px 0;
                border-bottom: 1px dashed rgba(0, 0, 0, .12);
            }
            .cms-grid .row:last-child { border-bottom: none; }

            /* Explicit page break — a labelled dashed rule so an
             * author can SEE why the following content will start on a new
             * sheet in the .docx. It is drawn by the node's NodeView, so
             * none of this reaches storage: the stored HTML is a bare
             * <hr data-page-break>, and PageBreakMapper reads the attribute.
             * Word's own convention (dashed rule + caption) on purpose —
             * a solid rule would read as a horizontal rule, which is a
             * DIFFERENT node that prints ink. */
            .cms-page-break {
                position: relative;
                margin: 1em 0;
                border-top: 2px dashed var(--cms-border);
                text-align: center;
                user-select: none;
            }
            /* Pulled up onto the rule and given the canvas colour so it reads
             * as a gap in the line rather than a caption under it. */
            .cms-page-break__label {
                position: relative;
                top: -.75em;
                padding: 0 .5em;
                background: var(--cms-surface);
                font-size: .7rem;
                letter-spacing: .06em;
                text-transform: uppercase;
                color: var(--cms-text-muted);
            }
            /* Atoms are selected whole; without this the only feedback for
             * "this is what Delete will remove" is ProseMirror's default
             * outline, which the dashed border swallows visually. */
            .cms-page-break.ProseMirror-selectednode { border-top-color: var(--cms-accent); }
            .cms-page-break.ProseMirror-selectednode .cms-page-break__label { color: var(--cms-accent); }

            /* A SECTION break, which is a different thing from a page break and
             * has to look like one: a page break starts a new page under the
             * same paper and the same headers, a section break is where those
             * can change. Double rule rather than dashed, so the two are told
             * apart at a glance rather than by reading the caption. */
            .cms-section-break {
                position: relative;
                margin: 1.25em 0;
                border-top: 3px double var(--cms-border);
                text-align: center;
                user-select: none;
            }
            .cms-section-break__label {
                position: relative;
                top: -.75em;
                padding: 0 .5em;
                background: var(--cms-surface);
                font-size: .7rem;
                letter-spacing: .06em;
                text-transform: uppercase;
                color: var(--cms-text-muted);
            }
            .cms-section-break.ProseMirror-selectednode { border-top-color: var(--cms-accent); }
            .cms-section-break.ProseMirror-selectednode .cms-section-break__label { color: var(--cms-accent); }

            /* Callouts (note · warning · tip): tinted box + coloured left rule
             * per kind so the admonition reads as a block while editing —
             * parity with the published theme's .callout styles. */
            .callout {
                margin: .5em 0 .75em;
                padding: .5rem .75rem;
                border-left: 4px solid rgba(0, 0, 0, .2);
                border-radius: var(--cms-radius-sm, 4px);
                background: rgba(0, 0, 0, .03);
            }
            .callout > :first-child { margin-top: 0; }
            .callout > :last-child  { margin-bottom: 0; }
            .callout-note    { border-left-color: #0d6efd; background: rgba(13, 110, 253, .08); }
            .callout-warning { border-left-color: #ffc107; background: rgba(255, 193, 7, .12); }
            .callout-tip     { border-left-color: #198754; background: rgba(25, 135, 84, .10); }
            /* Callout NodeView title line (icon + localized label + the in-place
             * type switcher pushed to the top-right). Decoration only — never
             * serialised (renderHTML emits the bare box). The body wrapper is
             * the NodeView's contentDOM. */
            .callout__title {
                display: flex;
                align-items: center;
                gap: .4rem;
                margin-bottom: .5rem;
                font-weight: 600;
                line-height: 1.2;
                user-select: none;
            }
            .callout__icon-holder { display: inline-flex; flex: 0 0 auto; }
            .callout__icon { width: 1.1em; height: 1.1em; }
            .callout__label { flex: 1 1 auto; }
            .callout__switcher {
                flex: 0 0 auto;
                font-size: .75rem;
                padding: 1px 4px;
                border: 1px solid rgba(0, 0, 0, .15);
                border-radius: var(--cms-radius-sm, 4px);
                background: rgba(255, 255, 255, .7);
                color: inherit;
                cursor: pointer;
            }
            .callout__body > :first-child { margin-top: 0; }
            .callout__body > :last-child  { margin-bottom: 0; }
            .callout-note    .callout__title { color: #0a58ca; }
            .callout-warning .callout__title { color: #997404; }
            .callout-tip     .callout__title { color: #146c43; }

 /* Inline math atom — MathNodeView renders a KaTeX
             * preview into this span (or the raw source as a fallback). A faint
             * tinted chip so the formula reads as an editable atom; the selected
             * state borrows ProseMirror's selectednode class. Display-mode math
             * centres on its own line. KaTeX's own stylesheet (loaded globally)
             * styles the rendered .katex markup inside. */
            .cms-math {
                display: inline-block;
                padding: 0 .15em;
                border-radius: 3px;
                background: rgba(13, 110, 253, .06);
                cursor: pointer;
                vertical-align: baseline;
            }
            .cms-math:hover { background: rgba(13, 110, 253, .12); }
            .cms-math.ProseMirror-selectednode {
                background: rgba(13, 110, 253, .18);
                outline: 1px solid rgba(13, 110, 253, .5);
            }
            .cms-math--display { display: block; text-align: center; margin: .5em 0; }
            .cms-math--empty, .cms-math--error {
                font-family: var(--cms-font-mono, monospace);
                font-size: .85em;
                color: #b07014;
            }
            .cms-math--error { background: rgba(220, 53, 69, .1); }

            /* Self-contained col-N geometry — independent of Bootstrap. */
            .row > [class*="col-"] { padding: 8px 12px; box-sizing: border-box; }
            .col-1  { flex: 0 0 8.3333%;  max-width: 8.3333%; }
            .col-2  { flex: 0 0 16.6666%; max-width: 16.6666%; }
            .col-3  { flex: 0 0 25%;      max-width: 25%; }
            .col-4  { flex: 0 0 33.3333%; max-width: 33.3333%; }
            .col-5  { flex: 0 0 41.6666%; max-width: 41.6666%; }
            .col-6  { flex: 0 0 50%;      max-width: 50%; }
            .col-7  { flex: 0 0 58.3333%; max-width: 58.3333%; }
            .col-8  { flex: 0 0 66.6666%; max-width: 66.6666%; }
            .col-9  { flex: 0 0 75%;      max-width: 75%; }
            .col-10 { flex: 0 0 83.3333%; max-width: 83.3333%; }
            .col-11 { flex: 0 0 91.6666%; max-width: 91.6666%; }
            .col-12 { flex: 0 0 100%;     max-width: 100%; }

            /* Column wrapper. min-height keeps empty cells visible. */
            .cms-grid-column {
                position: relative;
                min-height: 48px;
                transition: background .15s;
            }
            /* Default boundary: gray dashed (structural hint, no urgency).
             * pointer-events: none lets clicks fall through to ProseMirror. */
            .cms-grid-column::before {
                content: '';
                position: absolute;
                inset: 0;
                border: 1px dashed rgba(0, 0, 0, .22);
                background: rgba(0, 0, 0, .015);
                border-radius: 2px;
                pointer-events: none;
                transition: border-color .15s, background .15s;
            }
            /* Hover: orange tint, signals the column the resize handle will
             * act on if the cursor moves to the right edge. */
            .cms-grid-column:hover::before {
                border-color: color-mix(in srgb, var(--cms-accent) 55%, transparent);
                background: color-mix(in srgb, var(--cms-accent) 4%, transparent);
            }
            /* Focus inside the column (typing in a child block): a stronger
             * orange so the "active" column is unambiguous in multi-column
             * layouts. */
            .cms-grid-column:focus-within::before {
                border-color: color-mix(in srgb, var(--cms-accent) 70%, transparent);
                background: color-mix(in srgb, var(--cms-accent) 6%, transparent);
            }
            .cms-grid-column__content { min-height: 24px; }
            /* Resize handle: invisible by default, lights up on hover of
             * the column wrapper, fully filled while dragging. z-index above
             * the ::before pseudo-border so the colour is visible. */
            .cms-grid-column__handle {
                position: absolute;
                top: 0;
                right: -4px;
                width: 8px;
                height: 100%;
                cursor: col-resize;
                background: transparent;
                z-index: 2;
                user-select: none;
            }
            .cms-grid-column:hover > .cms-grid-column__handle {
                background: color-mix(in srgb, var(--cms-accent) 25%, transparent);
            }
            .cms-grid-column__handle--dragging,
            .cms-grid-column__handle--dragging:hover {
                background: color-mix(in srgb, var(--cms-accent) 55%, transparent);
            }
            /* Live drag preview — overrides Bootstrap's col-N width while
             * the user is dragging. Removed automatically on mouseup. */
            .cms-grid-column[data-cms-grid-preview="1"]  { flex: 0 0 8.3333%;  max-width: 8.3333%; }
            .cms-grid-column[data-cms-grid-preview="2"]  { flex: 0 0 16.6666%; max-width: 16.6666%; }
            .cms-grid-column[data-cms-grid-preview="3"]  { flex: 0 0 25%;      max-width: 25%; }
            .cms-grid-column[data-cms-grid-preview="4"]  { flex: 0 0 33.3333%; max-width: 33.3333%; }
            .cms-grid-column[data-cms-grid-preview="5"]  { flex: 0 0 41.6666%; max-width: 41.6666%; }
            .cms-grid-column[data-cms-grid-preview="6"]  { flex: 0 0 50%;      max-width: 50%; }
            .cms-grid-column[data-cms-grid-preview="7"]  { flex: 0 0 58.3333%; max-width: 58.3333%; }
            .cms-grid-column[data-cms-grid-preview="8"]  { flex: 0 0 66.6666%; max-width: 66.6666%; }
            .cms-grid-column[data-cms-grid-preview="9"]  { flex: 0 0 75%;      max-width: 75%; }
            .cms-grid-column[data-cms-grid-preview="10"] { flex: 0 0 83.3333%; max-width: 83.3333%; }
            .cms-grid-column[data-cms-grid-preview="11"] { flex: 0 0 91.6666%; max-width: 91.6666%; }
            .cms-grid-column[data-cms-grid-preview="12"] { flex: 0 0 100%;     max-width: 100%; }

            /* formField chip — inline atom node rendered by FormFieldNodeView.
             * Distinct visual treatment from prose so authors can spot fields
             * at a glance; click on the chip dispatches the edit action via
             * the cms-form-field-edit custom event. */
            .cms-form-field {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 1px 6px;
                margin: 0 1px;
                background: color-mix(in srgb, var(--cms-accent) 15%, transparent);
                border: 1px dashed color-mix(in srgb, var(--cms-accent) 50%, transparent);
                border-radius: var(--cms-radius-sm, 4px);
                cursor: pointer;
                user-select: none;
                font-size: .9em;
                line-height: 1.4;
                white-space: nowrap;
                vertical-align: baseline;
            }
            .cms-form-field:hover { background: color-mix(in srgb, var(--cms-accent) 25%, transparent); }
            .cms-form-field--selected,
            .cms-form-field.ProseMirror-selectednode {
                background: color-mix(in srgb, var(--cms-accent) 35%, transparent);
                border-style: solid;
            }
            .cms-form-field__icon { font-size: .9em; color: #b07014; }
            .cms-form-field__label { font-weight: 500; color: #1f2937; }
            .cms-form-field__type-hint {
                font-size: .8em;
                opacity: .7;
                font-style: italic;
                color: var(--cms-text-secondary);
            }
            .cms-form-field__required { color: var(--cms-danger); font-weight: 700; margin-left: 2px; }

            /* Tiptap @tiptap/extension-table editor styles. Mirror the
             * gridLayout colour hierarchy: gray dashed cell borders by
             * default, orange tint on hover, full orange highlight on
             * Tiptap's selectedCell class and the column-resize-handle.
             * The package ships behaviour only — without these rules
             * tables render border-less in the editor. Production
             * rendering uses whatever the theme provides.
             *
             *  These reach the REPEATED header too, and have to: it is a row
             * of this same table, drawn again by a widget decoration. That is
             * the whole reason it is drawn there rather than beside the page. */
            table {
                border-collapse: collapse;
                margin: .5em 0 .75em;
                table-layout: fixed;
                width: 100%;
                overflow: hidden;
            }
            table td, table th {
                border: 1px dashed rgba(0, 0, 0, .22);
                box-sizing: border-box;
                min-width: 60px;
                min-height: 32px;
                padding: 6px 10px;
                position: relative;
                vertical-align: top;
                word-break: break-word;
                transition: background .15s;
            }
            table th {
                background: rgba(0, 0, 0, .04);
                font-weight: 600;
                text-align: left;
            }
            /*  A repeated header is a copy, not a place to work: no caret, no
             * selection, and no hover telling the author a cell is live. */
            tr.cms-repeat-header, tr.cms-repeat-header > * {
                pointer-events: none;
                user-select: none;
            }
            /* Hover signals the cell the cursor will land in; matches the
             * gridLayout column hover for a consistent "active region" cue. */
            table td:hover, table th:hover { background: color-mix(in srgb, var(--cms-accent) 4%, transparent); }
            /* Tiptap stamps the selectedCell class on cells the user has
             * selected (single click, click-and-drag, full-row / full-column
             * shortcuts). The ::after overlay is the canonical pattern from
             * Tiptap's own examples — sits above the cell content but below
             * the resize handle. */
            table .selectedCell::after {
                content: '';
                position: absolute;
                inset: 0;
                background: color-mix(in srgb, var(--cms-accent) 15%, transparent);
                pointer-events: none;
                z-index: 2;
            }
            /* Tiptap's resize handle: rendered as an empty div on the cell.
             *
             * Reported as "cursor over cell border looks like caret",
             * and it did: a 4px saturated bar, per-cell so it broke into
             * segments, has exactly a caret's proportions and turns up where an
             * insertion point plausibly would. Now 2px and full-bleed top and
             * bottom, so the segments in a column JOIN into one continuous line
             * down the table — a caret is never table-tall, which is the signal
             * that separates the two at a glance. Solid rather than 55% mixed
             * because half the ink at half the width would stop being findable,
             * which is what the previous note was protecting.
             *
             * Narrowing the paint does NOT narrow the target: the handle is
             * pointer-events:none and ProseMirror decides grabbing from the
             * pointer's distance to the cell edge, not from this box. The mouse
             * cursor is already handled by the resize-cursor rule below. */
            table .column-resize-handle {
                position: absolute;
                top: -1px;
                right: -1px;
                bottom: -1px;
                width: 2px;
                background: var(--cms-accent);
                pointer-events: none;
            }
            .ProseMirror.resize-cursor { cursor: col-resize; }

 /* -- Editor code block (lowlight) + code tabs.
             * A dark "code box" with the atom-one-dark token palette so authors
             * see coloured syntax while editing. The highlight spans come from
             * CodeBlockLowlight's view-layer decorations — getHTML() still emits
             * clean <pre><code class="language-x">source</code></pre> (no hljs
             * spans), so stored content stays inside the sanitiser allow-list.
             * The same palette is mirrored in theme-default's app.scss. */
            .cms-code-block { position: relative; margin: .5em 0 .75em; }
            .cms-code-block__lang {
                position: absolute;
                top: 6px;
                right: 6px;
                z-index: 2;
                font-size: .72rem;
                line-height: 1.4;
                padding: 1px 4px;
                color: #abb2bf;
                background: rgba(255, 255, 255, .08);
                border: 1px solid rgba(255, 255, 255, .18);
                border-radius: var(--cms-radius-sm, 4px);
                cursor: pointer;
            }
            .cms-code-block__lang:hover { background: rgba(255, 255, 255, .16); }

            pre {
                background: #282c34;
                color: #abb2bf;
                padding: 12px 14px;
                border-radius: var(--cms-radius, 6px);
                overflow-x: auto;
                font-family: var(--cms-font-mono, monospace);
                font-size: .85rem;
                line-height: 1.5;
                white-space: pre;
            }
            pre code {
                background: none;
                color: inherit;
                padding: 0;
                font-size: inherit;
                font-family: inherit;
            }
            /* atom-one-dark token palette (shared verbatim with theme-default). */
            pre code .hljs-comment, pre code .hljs-quote { color: #5c6370; font-style: italic; }
            pre code .hljs-doctag, pre code .hljs-keyword, pre code .hljs-formula { color: #c678dd; }
            pre code .hljs-section, pre code .hljs-name, pre code .hljs-selector-tag,
            pre code .hljs-deletion, pre code .hljs-subst { color: #e06c75; }
            pre code .hljs-literal { color: #56b6c2; }
            pre code .hljs-string, pre code .hljs-regexp, pre code .hljs-addition,
            pre code .hljs-attribute, pre code .hljs-meta .hljs-string { color: #98c379; }
            pre code .hljs-attr, pre code .hljs-variable, pre code .hljs-template-variable,
            pre code .hljs-type, pre code .hljs-selector-class, pre code .hljs-selector-attr,
            pre code .hljs-selector-pseudo, pre code .hljs-number { color: #d19a66; }
            pre code .hljs-symbol, pre code .hljs-bullet, pre code .hljs-link,
            pre code .hljs-meta, pre code .hljs-selector-id, pre code .hljs-title { color: #61aeee; }
            pre code .hljs-built_in, pre code .hljs-title.class_,
            pre code .hljs-class .hljs-title { color: #e6c07b; }
            pre code .hljs-emphasis { font-style: italic; }
            pre code .hljs-strong { font-weight: 700; }
            pre code .hljs-link { text-decoration: underline; }

            /* code tabs: a tab strip above the stacked code panels. */
            .cms-code-tabs { margin: .5em 0 .75em; border-radius: var(--cms-radius, 6px); overflow: hidden; }
            .cms-code-tabs__bar {
                display: flex;
                flex-wrap: wrap;
                gap: 2px;
                padding: 4px 4px 0;
                background: #21252b;
            }
            .cms-code-tabs__tab {
                font-size: .75rem;
                padding: 4px 10px;
                color: #abb2bf;
                background: transparent;
                border: none;
                border-top-left-radius: var(--cms-radius-sm, 4px);
                border-top-right-radius: var(--cms-radius-sm, 4px);
                cursor: pointer;
            }
            .cms-code-tabs__tab:hover { background: rgba(255, 255, 255, .06); }
            .cms-code-tabs__tab--active { background: #282c34; color: var(--cms-text-inverse); }
            .cms-code-tabs__panels .cms-code-block { margin: 0; }
            .cms-code-tabs__panels pre { margin: 0; border-radius: 0; }
        }
    `],
})
export class CoolmsEditorComponent implements AfterViewInit, OnDestroy {
    readonly profile        = input.required<string>();
    readonly content        = model<string>('');
    readonly contentAdapter = input<ContentAdapter | null>(null);
    /**
     * Opaque string the host bumps to force a clean re-mount of Tiptap with
     * the current `content`. Use case: page-editor's locale tabs — switching
     * BE -> EN swaps the storage payload, and we want a fresh Tiptap instance
     * so cursor / undo history don't leak across documents.
     */
    readonly mountKey = input<string>('');

    /**
     * Paper dimensions (CSS lengths) that turn the canvas into SHEETS — the
     * "Word look". Null keeps the plain flowing canvas every other
     * surface uses; a web page has no pages, and drawing one there would be a
     * lie about the output.
     *
     * ## What the sheets do and do not claim
     *
     * The width and margins are exact, and every EXPLICIT page break starts a
     * new sheet — so what you see matches the .docx wherever the author decided
     * the pages. Content that overflows a sheet is NOT re-flowed onto the next
     * one: that needs Word's line-breaking and font metrics, and a browser's
     * answer would be a confident second opinion that disagrees with the file.
     * The sheet keeps growing instead, which reads as "this page is too long"
     * rather than as a wrong page count.
     */
    readonly pageGeometry = input<PageGeometry | null>(null);

    /**
     * Load the units a stored DOCUMENT needs and page content does not.
     *
     * ## Why this is a switch and not simply always on
     *
     * ProseMirror strips what it cannot model, so a document carrying an
     * underline, a picture or a footnote reference loses it the moment an
     * editor without those units opens the file. That argues for always on —
     * and the page path argues the other way: `HtmlProfileSanitizer` removes
     * `<u>` and `<img>` from page content on save, so an editor that kept them
     * would show an author something the server then silently discards. Two
     * surfaces disagreeing about what survives is worse than either rule.
     *
     * Documents do not pass through that sanitizer, which is exactly where
     * these belong and where they are switched on.
     */
    readonly preserveDocumentFormatting = input<boolean>(false);

    @ViewChild('editorMount') private editorMountRef?: ElementRef<HTMLElement>;

    private readonly host         = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly source       = inject(EDITOR_MANIFEST_PROVIDER);
    private readonly actions      = inject(EditorActionRegistry);
    private readonly extensions   = inject(EditorExtensionRegistry);

    /** The vendored faces the engine measures. Null until they arrive. */
    private documentFonts: FontCatalogue | null = null;
    private fontsRequested = false;
    private engineRequested = false;

    /**
     * Every family the catalogue has been asked for.
     *
     *  A document names its own faces per RUN, and the engine holds only
     * what it was told to fetch -- an unheld family resolves to the base one,
     * which is a silent change to the page count. So the families are collected
     * from the document and requested before the layout can be wrong about
     * them.
     */
    private readonly requestedFamilies = new Set<string>([DOCUMENT_FONT_FAMILY]);

    /**
     * Where each page begins, as document positions, straight from the engine.
     *
     * Position 0 is page one. Everything after it is a boundary the engine
     * FOUND — including the ones no author placed, which is what makes the
     * counter describe the document rather than the breaks in it.
     */
    private readonly pageStarts = signal<readonly number[]>([0]);

    /** Sheet height plus the workspace gap — the distance from page to page. */
    private pagePitchPx = 0;
    /** The TOP margin the gaps are aligned against -- where page N's text starts. */
    private pageMarginTopPx = 0;
    private readonly injector     = inject(Injector);
    private readonly translate    = inject(EDITOR_TRANSLATE, { optional: true });

    /** Toggles the textarea source view. */
    readonly sourceMode = signal(false);
    /** Bumps when Tiptap fires `update`/`selectionUpdate` so isActive recomputes. */
    private readonly stateTick = signal(0);
    /** Live Tiptap instance; null while torn down. */
    private tiptap: Editor | undefined;

    /** Listener bound on mount so we can detach on unmount / re-mount. */
    private formFieldEditListener: ((event: Event) => void) | undefined;

    /**
     * Resolved profile slice for the active `profile` input. Returns null
     * when the manifest doesn't carry the named profile (e.g. anonymous
     * boot pre-login, or a typo). Treated as "no toolbar / no widgets" by
     * downstream computeds so the editor still mounts a usable surface.
     */
    private readonly profileSlice = computed<EditorProfileManifest | null>(() =>
        this.source.getProfile(this.profile()),
    );

    /** Manifest nodes for this profile, sorted + grouped for the toolbar. */
    /**
     * The group the font cluster belongs beside: the other character
     * formatting. `format` is the manifest's own bucket name
     * ({@see EditorToolbarNode}), so this reads against the contract rather
     * than against whatever happens to be first.
     */
    private static readonly FONT_SLOT_AFTER = 'format';

    /** Contributed groups and the editor's own clusters, in one order. */
    readonly toolbarSlots = computed<ReadonlyArray<ToolbarSlot>>(() => {
        // Gated on paged(): this IS the Word-look document editor, which is
        // where a font belongs. An inline or comment profile is not paged and
        // gets no font pickers, while the MARK stays registered everywhere so
        // their documents never lose formatting they already have.
        const font = this.paged() && !this.sourceMode();
        const slots: ToolbarSlot[] = [];

        for (const group of this.groupedNodes()) {
            slots.push({ key: 'nodes:' + group.name, kind: 'nodes', nodes: group.nodes });
            if (font && CoolmsEditorComponent.FONT_SLOT_AFTER === group.name) {
                slots.push({ key: 'font', kind: 'font' });
            }
        }

        // A profile with no `format` group still gets its pickers, at the end —
        // exactly where they used to be. Falling back to the old position beats
        // dropping the controls because a manifest was shaped unexpectedly.
        if (font && !slots.some((slot) => 'font' === slot.kind)) {
            slots.push({ key: 'font', kind: 'font' });
        }

        return slots;
    });

    readonly groupedNodes = computed<ReadonlyArray<ToolbarGroup>>(() => {
        const nodes = this.profileSlice()?.contributors ?? [];
        // Group preserves the (group, priority) order from the resolver.
        const map = new Map<string, EditorToolbarNodeManifest[]>();
        for (const n of nodes) {
            const list = map.get(n.group) ?? [];
            list.push(n);
            map.set(n.group, list);
        }
        return Array.from(map, ([name, ns]) => ({ name, nodes: ns }));
    });

    /** Active profile's storage allow-list. Empty array when unknown. */
    private readonly allowedWidgets = computed<ReadonlyArray<string>>(() =>
        this.profileSlice()?.allowedWidgets ?? [],
    );

    /** Tracks whether the first mount has happened so re-mount triggers
     *  fire only after the view is stable. Without this, the effect below
     *  would race with ngAfterViewInit and double-mount on first paint. */
    private mounted = false;

    /**
     * Empty/non-empty flip of the bound content. The mount effect tracks
     * this (not the full content body) so the editor remounts when content
     * arrives async after an empty initial mount, but stays put across
     * keystrokes (which keep emptiness=false consistently).
     */
    private readonly contentEmptiness = computed(() => this.content().trim() === '');

    /**
     * The last value this editor pushed OUT through `content`.
     *
     * Lets the mount effect tell content arriving from the host apart from
     * content the author just typed — see the effect for why that matters.
     */
    private selfEmitted: string | null = null;

    /** What the mount effect saw last time, so it knows WHICH input moved. */
    private lastMountTriggers: {
        profile: unknown;
        nodes: unknown;
        key: unknown;
        empty: boolean;
    } | null = null;

    constructor() {
        // Re-mount whenever profile, manifest contributors, the host-supplied
        // mountKey, or the content's empty-vs-non-empty state change. We
        // deliberately don't track the content body itself so keystrokes
        // don't tear down the editor.
        effect(() => {
            const triggers = {
                profile: this.profile(),
                nodes: this.groupedNodes(),
                key: this.mountKey(),
                empty: this.contentEmptiness(),
            };
            const previous = this.lastMountTriggers;
            this.lastMountTriggers = triggers;
            if (!this.mounted || null === previous) {
                return;
            }

            //  An emptiness flip the AUTHOR caused is not content arriving.
            //
 // This was that defect, reported as "I press Enter and the cursor
            // disappears, then comes back at the first position — it looks like
            // a reset". It was: typing the first character into an EMPTY
            // document takes `content` from '' to '<p></p>', which flips
            // `contentEmptiness` and remounts Tiptap underneath the keystroke.
            // A fresh editor has a fresh selection, so the caret goes to the
            // start of the document and the focus goes nowhere.
            //
            // The flip this effect is FOR — a host that mounts the editor empty
            // and fetches the content afterwards — looks identical from
            // emptiness alone. What separates them is authorship, so that is
            // what is tested: content the editor itself just emitted is content
            // it already holds, and re-installing it can only lose the caret.
            // Read untracked, or the effect would depend on every keystroke.
            const onlyEmptinessMoved = previous.profile === triggers.profile
                && previous.nodes === triggers.nodes
                && previous.key === triggers.key;
            if (onlyEmptinessMoved && untracked(() => this.content()) === this.selfEmitted) {
                return;
            }

            // Defer past the current change-detection cycle so the
            // ViewChild ref is fresh when we read it again.
            setTimeout(() => void this.mount(), 0);
        });

        // Paper dimensions ride on the HOST as custom properties, set
        // imperatively rather than bound. The host element always exists — the
        // mount comes and goes with source mode — and custom properties
        // inherit, so one write reaches every sheet rule below. Clearing them
        // when the geometry goes away matters: a stale --cms-page-width on a
        // non-paged editor would size nothing today and something wrong later.
        effect(() => {
            const style = this.host.nativeElement.style;
            const geometry = this.pageGeometry();
            if (geometry) {
                style.setProperty('--cms-page-width', geometry.width);
                style.setProperty('--cms-page-height', geometry.height);
                // Written in the SAME breath as the paper, and defaulted here
                // rather than in a CSS fallback, so the four sides can never be
                // undefined while the paged class is on the host.
                const margins = pageMarginsOf(geometry);
                for (const [side, property] of Object.entries(PAGE_MARGIN_PROPERTIES)) {
                    style.setProperty(property, margins[side as keyof PageMargins]);
                }
            } else {
                style.removeProperty('--cms-page-width');
                style.removeProperty('--cms-page-height');
                style.removeProperty('--cms-page-zoom');
                for (const property of Object.values(PAGE_MARGIN_PROPERTIES)) {
                    style.removeProperty(property);
                }
            }
            this.fitSheet();
        });
    }

    ngAfterViewInit(): void {
        this.mounted = true;
        void this.mount();
        this.requestOfferedFamilies();

        // The pane changes width for reasons this component never hears about
        // — the split preview opening, fullscreen, the browser window.
        // Observing the HOST rather than the mount covers all of them with one
        // subscription that survives source mode: the mount element is inside
        // an @if and is replaced every time it toggles, so an observer bound to
        // it would end up watching a detached node.
        this.fitObserver = new ResizeObserver(() => this.fitSheet());
        this.fitObserver.observe(this.host.nativeElement);
        this.fitSheet();
    }

    ngOnDestroy(): void {
        this.fitObserver?.disconnect();
        // Before the editor goes: a frame booked by the last keystroke would
        // otherwise fire against a destroyed view and throw where nobody is
        // looking.
        if (0 !== this.paginateFrame) {
            cancelAnimationFrame(this.paginateFrame);
            this.paginateFrame = 0;
        }
        this.tiptap?.destroy();
    }

    /** True when the host handed us paper — the "Word look" canvas. */
    readonly paged = computed<boolean>(() => null !== this.pageGeometry());

    /** Watches the workspace so the sheet re-fits when the pane resizes. */
    private fitObserver?: ResizeObserver;

    /**
     * The frame a repagination is already booked for; 0 when none is.
     *
     * `fitSheet()` deliberately does NOT go through the scheduler: a resize
     * observer fires at most once a frame already, and its call runs in the same
 * frame as the zoom it just wrote — which is the timing that was fixed
     * against and is not worth disturbing for a burst that cannot happen there.
     */
    private paginateFrame = 0;

    /**
     * Scale the sheet down until it fits the pane, the way Word's zoom-to-fit
     * does — and never up.
     *
     * A4 landscape is 1123px of paper; the dialog gives about 950. Without
     * this the page is simply cut off on the right, which is the one thing a
     * paged canvas exists to prevent. Magnifying is deliberately not offered:
     * blowing a small page up to fill a wide pane would misrepresent how much
     * fits on it, and the point of the sheet is that its size means something.
     *
     * The paper width is measured with a PROBE rather than read off the sheet
     * itself: the sheet already carries the zoom this method sets, so
     * measuring it would feed the result back into its own input and settle on
     * whatever the first frame happened to be.
     */
    /**
     * The zoom the author chose, or null to follow the fit.
     *
     *  `fitSheet()` runs on every resize AND every repaginate, so without a
     * separate override a chosen zoom would be recomputed away by the next
     * keystroke. Null means "no preference expressed", which is a different
     * state from "chose 100%" — the latter must survive a resize that the
     * former should follow.
     */
    private readonly zoomOverride = signal<number | null>(null);

    /** The last computed fit, so the control can show it and step from it. */
    private readonly fittedZoom = signal(1);

    /**
     * Whether the canvas is safe to look at.
     *
     * Tiptap paints the entire document as one continuous column the moment it
     * mounts; the page boundaries only exist once the document fonts have
     * loaded and `repaginate()` has run. Between those two moments the author
     * sees their text unsplit and then watches it jump onto its pages — the
     * reported "text jumps to the pages it belongs to".
     *
     * Only the PAGED canvas has that gap. An inline editor has no pagination to
     * wait for, so it starts ready and never shows the loader.
     */
    protected readonly canvasReady = signal(false);

    protected zoomPercent(): number {
        return Math.round((this.zoomOverride() ?? this.fittedZoom()) * 100);
    }

    protected isZoomFitted(): boolean {
        return null === this.zoomOverride();
    }

    protected zoomBy(factor: number): void {
        const from = this.zoomOverride() ?? this.fittedZoom();
        this.applyZoom(from * factor);
    }

    /** The named zooms. 100% is the point of the list — actual size is the one an author asks for. */
    protected readonly zoomSteps = [50, 75, 100, 125, 150, 200, 400];

    /** True when the current zoom is a chosen one that no step names. */
    protected isZoomCustom(): boolean {
        return !this.isZoomFitted() && !this.zoomSteps.includes(this.zoomPercent());
    }

    protected setZoomChoice(value: string): void {
        if ('fit' === value) {
            this.resetZoom();

            return;
        }

        const percent = Number.parseFloat(value);
        if (Number.isFinite(percent) && percent > 0) {
            this.applyZoom(percent / 100);
        }
    }

    /** Back to following the pane, which is where the canvas starts. */
    protected resetZoom(): void {
        this.zoomOverride.set(null);
        this.fitSheet();
    }

    /**
     * Ctrl/Cmd + wheel, the gesture every document editor uses.
     *
     * `preventDefault` is load-bearing: without it the BROWSER zooms the whole
     * admin instead, which is both wrong and hard to undo from inside a dialog.
     * A plain wheel is left alone so ordinary scrolling still works.
     */
    protected onWheelZoom(event: WheelEvent): void {
        if (!event.ctrlKey && !event.metaKey) return;

        event.preventDefault();
        // Proportional, not additive: a fixed step is coarse near 25% and
        // sluggish near 400%, where the eye reads zoom as a ratio.
        this.zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
    }

    private applyZoom(next: number): void {
        const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
        this.zoomOverride.set(Math.round(clamped * 1000) / 1000);
        this.fitSheet();
    }

    private fitSheet(): void {
        const host = this.host.nativeElement;
        const geometry = this.pageGeometry();
        const mount = this.editorMountRef?.nativeElement;
        if (!geometry || !mount) return;

        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;top:0;left:0;visibility:hidden;pointer-events:none;width:' + geometry.width;
        host.appendChild(probe);
        const paperPx = probe.offsetWidth;
        probe.remove();

        // The gutter keeps the sheet's shadow off the scrollbar; without it a
        // page that "just fits" sits flush against the edge and reads clipped.
        // The desk padding comes off too — `clientWidth` INCLUDES it, so a fit
        // computed without subtracting it sizes the page to space the padding
        // has already taken and the sheet overflows by exactly that much.
        // Measured on the SCROLLER, not the mount: the mount is
        // `width: max-content`, so its clientWidth is how wide the page already
        // IS — feeding that back in would make the fit agree with whatever it
        // last produced instead of with the space available.
        const scroller = mount.parentElement ?? mount;
        const desk = getComputedStyle(mount);
        const padding = Number.parseFloat(desk.paddingLeft) + Number.parseFloat(desk.paddingRight);
        const available = scroller.clientWidth - padding - SHEET_GUTTER_PX;
        const fitted = fitZoomFor(available, paperPx);

        // A zoom the author set WINS over the fit. Recomputing the fit on every
        // resize is right when nobody has expressed a preference and wrong the
        // moment somebody has — it would snap their choice away on the next
        // keystroke that triggers a repaginate.
        const zoom = this.zoomOverride() ?? fitted;

        this.fittedZoom.set(fitted);
        host.style.setProperty('--cms-page-zoom', String(Math.round(zoom * 1000) / 1000));
        this.repaginate();
    }

    /**
     * Turn the editable column into SHEETS.
     *
     * The user's report was "3 pages on 1 page? Just unusable" — and it was
     * accurate. A page break was decoration: a grey strip drawn across one
     * sheet that simply kept growing, while a counter in the toolbar said
     * "Page 1 of 3" about something nobody could see. Inserting a page break
     * has to produce a page.
     *
     * ## How
     *
     * ProseMirror keeps one flat list of blocks and a contenteditable cannot be
     * split across containers without breaking editing, so the paper is drawn
     * BEHIND the text instead, and each break is stretched until the content
     * after it starts on the next sheet:
     *
     *   1. walk the breaks in order, measuring where each one falls;
     *   2. the page it ends is at least one page tall — a short page still
     *      looks like a page — and taller if its content overran;
     *   3. give the break the height that fills the rest of that page, crosses
     *      the workspace gap, and clears the next page's top margin;
     *   4. emit one absolutely-positioned white box per page behind the text.
     *
     * Measurement happens INSIDE the loop, once per break, because setting a
     * height moves everything below it — reading all the offsets up front would
     * lay out every page against stale positions.
     *
     * ## The limit, stated rather than hidden
     *
     * Content that simply OVERFLOWS a page is not re-flowed onto the next one;
     * that page's sheet grows instead. Re-flowing means deciding where a
     * paragraph splits, which is Word's decision and not one a browser can make
     * identically — and guessing it would put a break on screen that the .docx
     * does not have. An explicit break is the author's instruction and is
     * honoured exactly.
     */
    /**
     * Book ONE repagination for the next frame, however many edits ask for it.
     *
     * ## Why this is not just a tidy-up
     *
     * `onUpdate` fires once per ProseMirror transaction, and the naive
     * `requestAnimationFrame(() => this.repaginate())` it used to call books a
     * SEPARATE callback every time. Callbacks queued during one frame all run in
     * the next, so a burst of edits does not coalesce — it queues. Holding Enter
     * repeats at roughly 30 keys a second, and the moment one repagination costs
     * more than the gap between two keystrokes the queue grows faster than it
     * drains: each entry re-lays-out a document that is longer than the one the
     * entry before it measured, and every one of them rebuilds every sheet and
     * books an `alignGaps` frame of its own. The editor stops painting, which is
     * what "it seems like it overloads" describes.
     *
     * Only the LAST of those repaginations could have been right anyway — the
     * ones before it measured a document that no longer exists. So the fix is
     * not to make them cheaper but to stop asking for them: one frame is
     * booked, later asks in the same frame ride on it, and the work happens once
     * against the final state.
     *
     * Deliberately a frame rather than a longer debounce: the paper must follow
     * the text closely enough that it never looks detached from it, and a frame
     * is already the point at which the DOM the measurement needs has settled.
     */
    private schedulePaginate(): void {
        if (0 !== this.paginateFrame) {
            return;
        }

        this.paginateFrame = requestAnimationFrame(() => {
            this.paginateFrame = 0;
            this.repaginate();
        });
    }

    private repaginate(): void {
        const mount = this.editorMountRef?.nativeElement;
        const geometry = this.pageGeometry();
        const editor = this.tiptap;
        if (!mount || !geometry || !editor) return;

        const surface = mount.querySelector<HTMLElement>('.ProseMirror');
        if (!surface) return;

        const fonts = this.documentFonts;
        if (!fonts) { this.requestDocumentFonts(); return; }

        // The layout engine is an OPTIONAL peer and is fetched, not imported,
        // so the first pass through here may arrive before it does. Same shape
        // as the fonts above: ask for it, return, and this runs again when it
        // lands. A consumer who never installed it never gets past this line,
        // which is what "optional" is supposed to mean.
        const engine = paginationEngine();
        if (!engine) { this.requestPaginationEngine(); return; }
        const { isFlowTable, paginateFlow } = engine;

        const pagePx  = this.cssLengthToPx(geometry.height);
        const widthPx = this.cssLengthToPx(geometry.width);
        // The document's own frame, not a fixed one. The engine measures with
        // these and the browser lays out with the padding written from the same
        // numbers, so the two cannot part company.
        const margins = pageMarginsOf(geometry);
        const marginPx = {
            top:    this.cssLengthToPx(margins.top),
            right:  this.cssLengthToPx(margins.right),
            bottom: this.cssLengthToPx(margins.bottom),
            left:   this.cssLengthToPx(margins.left),
        };
        if (pagePx <= 0 || widthPx <= 0) return;

        // Publish the numbers the engine is about to measure with, so the
        // browser lays the text out to the same metrics. Reading them back off
        // the DOM instead would let the two drift apart silently.
        const sizePx = this.cssLengthToPx(DOCUMENT_FONT_SIZE);
        const lineHeightPx = fonts.resolve(DOCUMENT_FONT_FAMILY, false, false).font.naturalLineHeight(sizePx);
        const style = this.host.nativeElement.style;
        style.setProperty('--cms-doc-size', sizePx + 'px');
        style.setProperty('--cms-doc-line', lineHeightPx + 'px');

        // The zoom the surface is CURRENTLY painted at. Read from the element
        // rather than from the signal so it reflects what the browser actually
        // applied — the two differ for one frame after a zoom change, and that
        // frame is exactly when this runs.
        const zoom = Number.parseFloat(getComputedStyle(surface).zoom) || 1;

        // Kept, not inlined into paginateFlow: a gap that opens a page inside a
        // table is a spacer ROW, and it has to span the table's grid.
        const items = flowBlocksFromDoc(editor.state.doc, {
                contentWidthPx: widthPx - marginPx.left - marginPx.right,
                ...this.measureBoxes(surface),
                faceIsLoaded,
                // The browser has already laid these out; asking it is both
                // exact and cheaper than modelling what it did.
                //
                //  DIVIDED BY THE ZOOM, and this is the whole of defect
 // `getBoundingClientRect()` reports the VISUAL box, so
                // CSS `zoom` scales it — while `pagePx` above comes from an
                // unzoomed probe. At 100% the two agree and everything is fine;
                // at 77% every block measures 77% of its real height while the
                // page is still full size, so the paginator believes far more
                // fits than does and places the following pages' content at the
                // wrong offsets. The reported symptom was text sliding down the
                // second and third pages as the author zoomed out.
                measureHeightAt: (pos: number): number | null => {
                    const node = editor.view.nodeDOM(pos);
                    if (!(node instanceof HTMLElement)) return null;

                    return node.getBoundingClientRect().height / zoom;
                },
                //  NOT divided by the zoom, unlike the rect above, and the
                // contrast is deliberate. Measured at zoom 0.982: a paragraph's
                // `margin-bottom` read 10.9969px, which is .75em of the
                // UNZOOMED 14.6625px body size — `getComputedStyle` resolves
                // lengths before the zoom is applied, where
                // `getBoundingClientRect()` reports after it. Dividing here
 // would re-introduce it with the sign flipped.
                measureBoxAt: (pos: number): BlockBox | null => {
                    const node = editor.view.nodeDOM(pos);
                    if (!(node instanceof HTMLElement)) return null;

                    const computed = getComputedStyle(node);
                    const px = (value: string): number => {
                        const parsed = Number.parseFloat(value);

                        return Number.isFinite(parsed) ? parsed : 0;
                    };

                    // A block with no readable size is not a block with a size
                    // of zero: report nothing and let it keep the base style
                    // until a pass that can see it.
                    const fontSizePx = px(computed.fontSize);
                    if (fontSizePx <= 0) return null;

                    // `normal` where the browser will not resolve it to a
                    // length — the engine then uses the face's own natural
                    // line height, which is what `normal` means.
                    const lineHeightPx = Number.parseFloat(computed.lineHeight);

                    return {
                        lineHeightPx: Number.isFinite(lineHeightPx) ? lineHeightPx : null,
                        fontSizePx,
                        bold: (Number.parseInt(computed.fontWeight, 10) || 400) >= 600,
                        spaceBeforePx: px(computed.marginTop),
                        spaceAfterPx: px(computed.marginBottom),
                    };
                },
            });

        // Before the layout, not after: a family that arrives later re-runs
        // this, and a family that never arrives leaves the base one measuring
        // -- which is the old behaviour and still the honest fallback.
        this.ensureDocumentFonts(editor.state.doc);

        const pagination = paginateFlow(
            items,
            {
                widthPx,
                heightPx:       pagePx,
                marginTopPx:    marginPx.top,
                marginRightPx:  marginPx.right,
                marginBottomPx: marginPx.bottom,
                marginLeftPx:   marginPx.left,
            },
            //  No `lineHeightPx` in the base either. It would answer for
            // every block that states none -- which, after the change in
            // `styled()`, is all of them -- and put the engine straight back on
            // the CSS number. `--cms-doc-line` above is the same face's
            // `naturalLineHeight()`, so nothing about what the browser DRAWS
            // changes here; only what the engine is told.
            { fonts, base: { fontFamily: DOCUMENT_FONT_FAMILY, fontSizePx: sizePx } },
        );

        // The rows the engine repeated, as the markup of the rows they copy.
        // They ride WITH the gap that opens their page, as widgets at the same
        // position -- so a header takes its own room and nothing has to reserve
        // any for it.
        const repeated = this.repeatedHeaderRows(editor, repeatedHeadersOf(pagination.pages));

        // A gap fills what is left of the page it ends, crosses the workspace,
        // and re-establishes the next page's top margin — the same arithmetic
        // the DOM version did, over the engine's coordinates instead of the
        // browser's.
        const gaps: PageGap[] = [];
        for (const start of pagination.pageStarts) {
            if (null === start.at) continue;

            // How far down the PREVIOUS page its content actually reached —
            // whichever of its text and its table rows ended lower. A page of
            // nothing but a table has no lines at all, and measuring only those
            // makes it look empty: the gap then comes out a whole page tall.
            const previous = pagination.pages[start.page - 1];
            const lastLine = previous.lines.at(-1);
            const lastRow  = previous.rows.at(-1);
            const usedTo   = Math.max(
                undefined === lastLine ? marginPx.top : lastLine.yPx + lastLine.heightPx,
                undefined === lastRow ? marginPx.top : lastRow.yPx + lastRow.heightPx,
            );
            // Fill out the page that ends, cross the workspace, and re-establish
            // the NEXT page's top margin -- which is why this side and not
            // another. Nothing is added for a repeated header: it is a ROW of
            // the same table, drawn after this gap, and it takes its own room.
            const heightPx = pagePx - usedTo + SHEET_GAP_PX + marginPx.top;

            // A page that begins at a table ROW is opened by a spacer ROW, not
            // by a block: a block between two rows is hoisted out of the table
            // by the parser, and a block inside one CELL grows that cell alone
            // and tears the row in half across the seam.
            const table = undefined === start.rowIndex ? undefined : items[start.blockIndex];
            const at = undefined === start.rowIndex
                ? start.at
                : rowPositionOf(editor.state.doc, start.blockIndex, start.rowIndex);
            // The row is gone for a frame after an edit removed it; there is
            // nothing to hang this page's gap on until the next measurement.
            if (null === at) continue;

            const headerRows = repeated.get(start.page);
            gaps.push({
                pos: at,
                heightPx,
                page: start.page,
                ...(undefined !== table && isFlowTable(table)
                    ? { columns: table.columnWidthsPx.length }
                    : {}),
                ...(undefined === headerRows ? {} : { headerRows }),
            });
        }

        // Meta only: the document does not change, so this neither enters the
        // undo history nor re-triggers onUpdate.
        //  ONE transaction, both metas. Two dispatches in a frame means the
        // second re-renders what the first drew, which is how the first attempt
        // at this lost every attribute it had just set.
        editor.view.dispatch(
            editor.state.tr
                .setMeta(paginationKey, gaps)
                .setMeta(lineBoxKey, lineBoxesFrom(items, pagination.pages))
                .setMeta('addToHistory', false),
        );

        this.pagePitchPx = pagePx + SHEET_GAP_PX;
        this.pageMarginTopPx = marginPx.top;
        requestAnimationFrame(() => this.alignGaps(gaps));

        // Page one starts at the top of the document; the rest start where the
        // engine says they do. The counter and goToPage() read this, so both
        // now describe REFLOW as well as the breaks the author placed.
        this.pageStarts.set([0, ...pagination.pageStarts.map((start) => start.at ?? 0)]);

        // An explicit break is an instruction, not content: any height it kept
        // from an earlier pass would be space the engine never accounted for.
        for (const element of Array.from(surface.querySelectorAll<HTMLElement>('.cms-page-break'))) {
            element.style.height = '';
        }

        // One sheet per page the ENGINE found, at the pitch the gaps enforce —
        // no measuring, because the position of every page is now known before
        // the browser lays anything out.
        // The flow has to reach the bottom of the LAST SHEET. The
        // sheets are absolutely positioned and contribute no height, and a
        // final page is usually mostly empty — measured, the text ended 580px
        // above the paper it sits on. The scrollable area therefore stopped
        // short of the page, so the desk's bottom padding had nothing to sit
        // below and the last sheet ran off the end of the canvas.
        const documentHeightPx = pagination.pages.length * (pagePx + SHEET_GAP_PX) - SHEET_GAP_PX;
        surface.style.minHeight = documentHeightPx + 'px';

        // The pages exist from here on, so the canvas is safe to reveal. Set
        // AFTER the sheets are built rather than at the top of this method:
        // revealing before the paper is drawn would trade a text jump for a
        // flash of unpapered text, which is the same defect wearing a hat.
        this.canvasReady.set(true);

        const layer = this.sheetLayer(mount);
        layer.style.height = documentHeightPx + 'px';
        layer.replaceChildren(...pagination.pages.map((_page, index) => {
            const sheet = document.createElement('div');
            sheet.className = 'cms-editor__sheet';
            sheet.style.top = (index * (pagePx + SHEET_GAP_PX)) + 'px';
            sheet.style.height = pagePx + 'px';
            return sheet;
        }));
    }

    /** The `<tr>` ProseMirror drew for one row of one table, or null. */
    private rowElement(editor: Editor, blockIndex: number, rowIndex: number): HTMLElement | null {
        const at = rowPositionOf(editor.state.doc, blockIndex, rowIndex);
        const node = null === at ? null : editor.view.nodeDOM(at);

        return node instanceof HTMLElement ? node : null;
    }

    /**
     * Each repeated header as the MARKUP of the rows it copies, by page.
     *
     * A clone of the author's own `<tr>`, so the columns, borders, backgrounds
     * and text are the ones on the screen and cannot drift from them; a replica
     * built from the model would be a second renderer to keep in step with the
     * first. Rebuilt on every repagination, so editing the header changes every
     * copy of it at once.
     *
     *  It is drawn as a ROW of the table it belongs to, which is what makes
     * the columns line up by construction -- `colspan` included -- and what
     * lets every rule the real header is dressed by reach the copy. A copy
     * drawn beside the table instead has to be positioned, sized and dressed
     * from the outside, and each of those is a chance to disagree with it.
     */
    /**
     * Draw the line box the ENGINE computed, instead of the one CSS picks.
     *
     * ## Why this is not "set line-height and be done"
     *
     * The engine's rule is `max(ascender + lineGap) + max(-descender)` -- each
     * side of the baseline maxed on its own, measured against LibreOffice at
     * 11 of 11. CSS has a different model: it gives every inline box
     * the stated height by splitting the leading HALF above and HALF below ITS
     * OWN content area, so two faces on one line end up at different offsets
     * and their union is taller than either.
     *
     * MEASURED with `tools/line-box-probe.html` at 11pt, px, against the
     * engine's H for the same runs:
     *
     *     line-height: normal (before)   17.600 / 18.400 / 18.400
     *     H on the block only            17.900 / 19.975 / 19.700
     *     H on block AND runs            17.900 / 19.975 / 19.700
     *     runs at 0, block at H          17.900 / 18.375 / 18.100
     *     the engine's H                 17.904 / 18.369 / 18.097
     *
     * ...for Carlito alone, Carlito + Liberation Mono, Liberation Serif + Mono.
     * Only the fourth row lands, and it lands within 0.006px.
     *
     *  The error ran in BOTH directions before this. A single-face page drew
     * 0.304px SHORT a line and a serif+mono page 0.303px LONG -- which is
 * exactly the measured "ends 17.1px above the bottom margin" and "8.5px below
     * it". One change, both pages.
     *
     * ##  What it does NOT reach
     *
     * `PlacedLine.paragraphIndex` indexes the TOP-LEVEL flow items, so a table
     * is one item and the paragraphs inside its cells are not among them. They
     * keep what they had, which is why the CSS is scoped by the attribute this
     * sets rather than written against `.ProseMirror p`: a rule that zeroed
     * runs the engine never measured would leave those cells drawing an
     * inherited number and call it a fix.
     *
     *  And CSS has ONE line-height per block. A paragraph whose LINES use
     * different face sets is drawn on its tallest, which is the only choice
     * that cannot make text overlap.
     *
     * ## It settles rather than oscillates
     *
     * Setting this changes the block's rendered height, and the next pass
     * measures that. It converges anyway: a paragraph's engine line box is
     * computed from its runs' FONT METRICS and size, not from the height the
 * browser reported -- `styled()` stopped passing that -- so the
     * second pass computes the same number and writes it again.
     */
    private repeatedHeaderRows(
        editor: Editor,
        headers: readonly RepeatedHeader[],
    ): Map<number, string[]> {
        const rows = new Map<number, string[]>();

        for (const header of headers) {
            const markup: string[] = [];
            for (const rowIndex of header.rowIndexes) {
                const source = this.rowElement(editor, header.blockIndex, rowIndex);
                if (null === source) continue;

                const clone = source.cloneNode(true) as HTMLElement;
                for (const handle of Array.from(clone.querySelectorAll('.column-resize-handle'))) {
                    handle.remove();
                }
                for (const cell of Array.from(clone.querySelectorAll('.selectedCell'))) {
                    cell.classList.remove('selectedCell');
                }
                // A repeated header is the SAME row drawn again, not a second
                // occurrence -- which is the engine's own rule: it skips a
                // repeated row when collecting the notes a page owes. A marker
                // here would be a number no note in the list answers to.
                for (const marker of Array.from(clone.querySelectorAll('sup[data-footnote]'))) {
                    marker.remove();
                }
                markup.push(clone.outerHTML);
            }

            if (0 !== markup.length) {
                rows.set(header.page, markup);
            }
        }

        return rows;
    }

    /**
     * Ask for any face this document names that has not been fetched.
     *
     * Returns immediately when there is nothing new, which is every keystroke
     * in a document that uses one family. When something IS new the catalogue
     * grows and the layout runs again -- the pages before that used the base
     * face, and are wrong, which is exactly why this re-runs rather than
     * leaving them.
     */
    private ensureDocumentFonts(doc: ProseMirrorNode): void {
        const fresh = fontFamiliesIn(doc).filter((family) => !this.requestedFamilies.has(family));
        if (0 === fresh.length) {
            return;
        }

        for (const family of fresh) {
            this.requestedFamilies.add(family);
        }

        loadDocumentFonts([...this.requestedFamilies])
            .then((fonts) => {
                this.documentFonts = fonts;
                this.repaginate();
            })
            .catch((error: unknown) => {
                console.error('[coolms-editor] a document font failed to load; pages may break early', error);
            });
    }

    /**
     * Fill the font select from the manifest.
     *
     * Names only -- no face is fetched here. The bytes arrive per family when a
     * document actually names one, which is what keeps the 7.2MB set off the
     * critical path.
     *
     * A failure leaves the select at "Default" and says so: offering a family
     * whose metrics we could not confirm is the defect this replaced.
     */
    private requestOfferedFamilies(): void {
        Promise.all([loadPaginationEngine(), loadFontManifest()])
            .then(([engine, manifest]) => this.fontFamilies.set(engine.offeredFontFamilies(manifest)))
            .catch((error: unknown) => {
                console.error('[coolms-editor] the font manifest failed to load; only the default family is offered', error);
            });
    }

    /**
     * Fetch the document faces once, then lay out again.
     *
     * Deliberately not awaited before the editor mounts: an author can type
     * immediately and the paper appears when the fonts arrive. A failure leaves
     * the canvas unpaginated rather than breaking the editor — being unable to
     * draw page boundaries is not a reason to be unable to write.
     */
    /**
     * Fetch the optional layout engine, once, then lay out again.
     *
     * Mirrors {@link requestDocumentFonts} deliberately: `repaginate()` has
     * two things it cannot proceed without, and both are asked for the same
     * way so neither becomes a special case. The error is logged once and the
     * canvas simply stays unpaginated -- which is the correct outcome for a
     * peer the consumer chose not to install.
     */
    private requestPaginationEngine(): void {
        if (this.engineRequested) return;
        this.engineRequested = true;

        loadPaginationEngine()
            .then(() => this.repaginate())
            .catch((error: unknown) => {
                console.error('[coolms-editor] @coolms/document-engine is not installed; the paged canvas will not paginate', error);
            });
    }

    private requestDocumentFonts(): void {
        if (this.fontsRequested) return;
        this.fontsRequested = true;

        loadDocumentFonts([DOCUMENT_FONT_FAMILY])
            .then((fonts) => {
                this.documentFonts = fonts;
                this.repaginate();
            })
            .catch((error: unknown) => {
                console.error('[coolms-editor] document fonts failed to load; the paged canvas will not paginate', error);
            });
    }

    /**
     * The boxes the engine cannot see: a cell's padding and rule, a list's
     * indent, and the margins under the paragraphs inside both.
     *
     * Read from REAL elements so the CSS stays the only place each value is
     * written: a constant here would be the same number twice, and a couple of
     * pixels a row is a whole page every forty rows.
     *
     * Falls back to nothing when the document has no table to measure — in which
     * case no table is being laid out either.
     */
    private measureBoxes(surface: HTMLElement): {
        cellPaddingPx: number;
        cellBorderPx: number;
        cellBorderStyle: BorderStyle;
        cellBorderColorHex: string;
        cellParagraphSpaceAfterPx: number;
        listIndentPx: number;
        listParagraphSpaceAfterPx: number;
        listSpaceAfterPx: number;
    } {
        const px = (value: string): number => {
            const parsed = parseFloat(value);

            return Number.isFinite(parsed) ? parsed : 0;
        };
        // The engine knows four looks; a cell drawn in any other is drawn as a
        // line, which is what every one of them is as far as ROOM goes.
        const borderStyle = (value: string | undefined): BorderStyle =>
            'dashed' === value || 'dotted' === value || 'double' === value ? value : 'solid';
        // `getComputedStyle` answers rgb()/rgba(); the model states #RRGGBB.
        // The alpha is dropped -- a rule's room does not depend on it, and a
        // hex colour has nowhere to keep it.
        const hex = (value: string | undefined): string => {
            const parts = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value ?? '');

            return null === parts
                ? '#000000'
                : '#' + parts.slice(1, 4)
                    .map((part) => Number(part).toString(16).padStart(2, '0'))
                    .join('');
        };

        const cell = surface.querySelector('td, th');
        const cellStyle = null === cell ? null : getComputedStyle(cell);
        // A paragraph inside a cell is styled differently from one in the body.
        // Read it rather than assume.
        //
        // These stay measured from ONE representative element while a top-level
        // block is measured individually (`measureBoxAt`), because a cell's
        // paragraphs are not the document's children: reaching each of them
        // through `nodeDOM` is a walk per paragraph per row, and every
        // paragraph in a cell answers the same. A body block does not — an h1,
 // a `p` and a blockquote all differ, and believing otherwise was that defect.
        const cellParagraph = cell?.querySelector('p') ?? null;

        const list = surface.querySelector('ul, ol');
        const listStyle = null === list ? null : getComputedStyle(list);
        const listParagraph = list?.querySelector('li > p') ?? null;


        return {
            //  PADDING ONLY, and the border reported beside it. This was
            // half of padding PLUS borders, and the engine applies it to both
            // sides of every row -- so a rule that `border-collapse` shares
            // between two rows was counted twice, and the engine's row came out
            // 42.90px against the browser's 41.69. The engine keeps a rule's
            // room itself, given the width.
            cellPaddingPx: null === cellStyle
                ? 0
                : (px(cellStyle.paddingTop) + px(cellStyle.paddingBottom)) / 2,
            cellBorderPx: null === cellStyle ? 0 : px(cellStyle.borderTopWidth),
            cellBorderStyle: borderStyle(cellStyle?.borderTopStyle),
            cellBorderColorHex: hex(cellStyle?.borderTopColor),
            cellParagraphSpaceAfterPx: null === cellParagraph
                ? 0
                : px(getComputedStyle(cellParagraph).marginBottom),
            // The list's padding is its indent per level, and its margin lands
            // once after the whole list rather than after each item.
            listIndentPx: null === listStyle ? 0 : px(listStyle.paddingLeft),
            listParagraphSpaceAfterPx: null === listParagraph
                ? 0
                : px(getComputedStyle(listParagraph).marginBottom),
            listSpaceAfterPx: null === listStyle ? 0 : px(listStyle.marginBottom),
        };
    }

    /**
     * Nudge each gap so the content after it starts exactly at its page's top
     * margin.
     *
     * Processed in document order and re-measured as it goes: changing one gap
     * moves everything below it, so reading all the positions up front would
     * correct every later page against a layout that no longer exists.
     *
     * Gaps sharing a page are the cells of one table row and must all move by
     * the SAME amount, or the row tears in half across the seam.
     */
    private alignGaps(gaps: readonly PageGap[]): void {
        const mount = this.editorMountRef?.nativeElement;
        const editor = this.tiptap;
        if (!mount || !editor || 0 === gaps.length) return;

        const surface = mount.querySelector<HTMLElement>('.ProseMirror');
        if (!surface) return;

        const corrected = gaps.map((gap) => ({ ...gap }));
        let changed = false;

        for (const page of [...new Set(corrected.map((gap) => gap.page))].sort((a, b) => a - b)) {
            const elements = Array.from(surface.querySelectorAll<HTMLElement>('.cms-page-gap'))
                .filter((element) => element.dataset['page'] === String(page));
            if (0 === elements.length) continue;

 // MIXED UNITS were a defect, and they cancel at 100% zoom
            // which is why this survived so long. `getBoundingClientRect()`
            // reports the VISUAL box, so CSS `zoom` scales it, while
            // `pagePitchPx` and `pageMarginTopPx` are engine numbers in unzoomed
            // layout px. At 77% the measured offset read 77% of the real one,
            // `delta` came out spuriously positive, the gap grew — and the text
            // on every page after the first slid down as the author zoomed out.
            //
            // Normalising the measurement is the correct end to fix: `delta` is
            // written back into `style.height`, which is layout px, so it has to
            // be in layout px too.
            const zoom = Number.parseFloat(getComputedStyle(surface).zoom) || 1;
            const surfaceTop = surface.getBoundingClientRect().top;
            const actual  = (elements[0].getBoundingClientRect().bottom - surfaceTop) / zoom;
            const desired = page * this.pagePitchPx + this.pageMarginTopPx;
            const delta   = desired - actual;

            // Sub-pixel drift is not worth a second render.
            if (Math.abs(delta) < 0.5) continue;

            for (const gap of corrected) {
                if (gap.page === page) gap.heightPx = Math.max(0, gap.heightPx + delta);
            }
            for (const element of elements) {
                // Apply now, so the NEXT page is measured against this correction
                // rather than against the layout it replaced.
                const host = gapHeightHost(element);
                host.style.height = Math.max(0, parseFloat(host.style.height) + delta) + 'px';
            }
            changed = true;
        }

        if (changed) {
            editor.view.dispatch(
                editor.state.tr.setMeta(paginationKey, corrected).setMeta('addToHistory', false),
            );
        }
    }

    /** The paper layer, created once and kept as the mount's first child. */
    private sheetLayer(mount: HTMLElement): HTMLElement {
        const existing = mount.querySelector<HTMLElement>(':scope > .cms-editor__sheets');
        if (existing) return existing;

        const layer = document.createElement('div');
        layer.className = 'cms-editor__sheets';
        layer.setAttribute('aria-hidden', 'true');
        mount.prepend(layer);

        return layer;
    }

    /**
     * Resolve a CSS length (297mm, 11pt) to px, which only the browser can do.
     *
     * Measured with getBoundingClientRect rather than offsetHeight, which is an
     * INTEGER: 11pt is 14.667px and offsetHeight calls it 15. Both the engine
     * and the canvas would then use 15 and agree with each other while
     * disagreeing with the .docx, where 11pt means 11pt — a third of a pixel per
     * line that becomes a whole line somewhere down a long document.
     */
    private cssLengthToPx(length: string): number {
        const host = this.host.nativeElement;
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;top:0;left:0;visibility:hidden;pointer-events:none;height:' + length;
        host.appendChild(probe);
        const px = probe.getBoundingClientRect().height;
        probe.remove();

        return px;
    }

    /**
     * How many sheets the document has: one, plus one per EXPLICIT page break.
     *
     * Deliberately counted from the DOCUMENT, not from measuring the rendered
     * height against the sheet. A measured count would be the browser's opinion
     * about where Word will break, and it would be wrong — different
     * line-breaking, different font metrics. This count is one an author can
     * act on, because it only reflects breaks they placed themselves.
     */
    readonly pageCount = computed<number>(() => this.pageStarts().length);

    /** Which sheet the caret sits on — breaks before it, plus one. */
    readonly currentPage = computed<number>(() => {
        this.stateTick();
        const editor = this.tiptap;
        if (!editor) return 1;

        const caret = editor.state.selection.from;
        const starts = this.pageStarts();

        // The last page whose start is at or before the caret.
        let page = 1;
        for (let index = 1; index < starts.length; index++) {
            if (starts[index] <= caret) page = index + 1;
        }
        return page;
    });

    /**
     * Put the caret at the top of sheet `n` and scroll it into view.
     *
     * Moves the CARET rather than just scrolling, so the author can start
     * typing on the page they navigated to — and so the counter agrees with
     * where they are. `focus(position)` is what resolves the position safely:
     * the offset after a break is a block boundary, not a text position, and
     * setting a text selection there directly throws when the next node is
     * another break.
     */
    goToPage(n: number): void {
        const editor = this.tiptap;
        if (!editor) return;

        // Straight from the engine, so a page reached by REFLOW is navigable
        // exactly like one the author broke to.
        const starts = this.pageStarts();
        const target = starts[Math.min(Math.max(n, 1), starts.length) - 1];

        // Page 1 starts at position 0 — and Tiptap's focus() treats a FALSY
        // position as "no position given", i.e. keep the current selection. So
        // focus(0) is a silent no-op and the one page you can never navigate
        // back to is the first. 'start' says the same thing in a form the API
        // does not throw away.
        editor.chain().focus(0 === target ? 'start' : target).scrollIntoView().run();
    }

    /**
     * Offered by NAME, not measured from the system, and READ FROM THE
     * MANIFEST rather than typed out.
     *
     * The name is what lands in the .docx, and the .docx is opened somewhere
     * else — so the useful list is the one Word and LibreOffice both resolve,
     * not whatever happens to be installed on the author's machine.
     *
     *  A literal here drifts, and silently. It offered Georgia, Verdana and
     * Tahoma, which the platform vendors nothing for: `familyOf` returned null,
     * so `faceIsLoaded` was false forever, so the flow mapper never named the
     * family and the ENGINE measured Carlito -- while CSS painted whatever the
     * machine had and LibreOffice printed Noto. Three faces, one run. Deriving
     * the list means installing a family is a manifest entry and nothing else.
     *
     * Empty until the manifest lands, which is one small JSON on init: a select
     * showing a font the platform cannot measure is the bug being fixed, so
     * showing none for a moment is the honest failure.
     */
    protected readonly fontFamilies = signal<readonly string[]>([]);

    /** The mark's attributes at the cursor, recomputed on every selection change. */
    private textStyleAttrs(): Partial<TextStyleAttributes> {
        // Same dependency isActive() takes: without it these read once and then
        // never again, so the controls would show the first cell's font
        // forever.
        this.stateTick();

        return (this.tiptap?.getAttributes('coolmsTextStyle') ?? {}) as Partial<TextStyleAttributes>;
    }

    protected fontFamily(): string {
        return this.textStyleAttrs().fontFamily ?? '';
    }

    protected fontSize(): string {
        const size = this.textStyleAttrs().fontSize;

        return null === size || undefined === size ? '' : String(size);
    }

    protected fontColor(): string {
        return this.textStyleAttrs().color ?? '';
    }

    protected setFontFamily(value: string): void {
        this.applyTextStyle({ fontFamily: '' === value ? null : value });
    }

    protected setFontSize(value: string): void {
        const size = Number.parseFloat(value);
        this.applyTextStyle({ fontSize: Number.isFinite(size) && size > 0 ? size : null });
    }

    protected setFontColor(value: string): void {
        this.applyTextStyle({ color: '' === value ? null : value });
    }

    protected fontHighlight(): string {
        return this.textStyleAttrs().background ?? '';
    }

    protected setFontHighlight(value: string): void {
        this.applyTextStyle({ background: '' === value ? null : value });
    }

    protected clearFont(): void {
        this.tiptap?.chain().focus().unsetCoolmsTextStyle().run();
        this.stateTick.update((t: number) => t + 1);
    }

    /**
     * `focus()` first, always. A toolbar click moves focus to the button, and a
     * command applied without restoring the selection lands nowhere — the
     * classic "the button does nothing" bug in a rich-text toolbar.
     */
    private applyTextStyle(attrs: Partial<TextStyleAttributes>): void {
        this.tiptap?.chain().focus().setCoolmsTextStyle(attrs).run();
        this.stateTick.update((t: number) => t + 1);
    }

    isActive(node: EditorToolbarNodeManifest): boolean {
        // Touch the tick so the template re-evaluates on selection updates.
        this.stateTick();
        const editor = this.tiptap;
        if (!editor) return false;
        for (const key of node.stateKeys) {
            // `[attr=value]` — an ATTRIBUTE with no node type, for a global
            // attribute that can sit on several (alignment is on paragraphs and
            // headings alike). Naming a type here would light the button up for
            // a centred paragraph and leave it dark for a centred heading.
            const attribute = /^\[([\w-]+)=([\w-]+)]$/.exec(key);
            if (attribute) {
                if (editor.isActive({ [attribute[1]]: attribute[2] })) return true;
                continue;
            }

            const [name, attr] = key.split('.');
            if (attr !== undefined && !Number.isNaN(Number(attr))) {
                if (editor.isActive(name, { level: Number(attr) })) return true;
            } else {
                if (editor.isActive(name)) return true;
            }
        }
        return false;
    }

    translateLabel(key: string): string {
        if (this.translate) return this.translate(key);
        return BUILTIN_LABEL_FALLBACKS[key] ?? key;
    }

    tooltip(node: EditorToolbarNodeManifest): string {
        const label = this.translateLabel(node.label);
        return node.shortcut ? `${label} (${node.shortcut})` : label;
    }

    dispatch(node: EditorToolbarNodeManifest, event?: Event): void {
        const anchor = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
        this.dispatchAction(node, anchor);
    }

    /**
     * Build the action context and route a manifest node through the action
     * bridge. Shared by the toolbar (`dispatch`) and the slash palette
     * (`onSelect`) so a `/`-command is dispatched identically to a click —
     * the palette never owns its own command list. `anchor` positions a
     * handler's popup (grid/table picker); the slash path passes null, which
     * those handlers treat as "centre on the viewport".
     */
    private dispatchAction(node: EditorToolbarNodeManifest, anchor: HTMLElement | null): void {
        const editor = this.tiptap;
        if (!editor && node.actionType !== 'editor.toggleSourceMode') return;
        const ctx: EditorActionContext = {
            editor:           editor!,
            profile:          this.profile(),
            allowedWidgets:   this.allowedWidgets(),
            injector:         this.injector,
            toggleSourceMode: () => this.toggleSourceMode(),
            getContent:       () => this.content(),
            setContent:       (html) => this.content.set(html),
            anchor,
        };
        void this.actions.dispatch(node.actionType, node.actionParams, ctx);
    }

    /**
     * The active profile's slash-insert palette: its slashable contributors,
     * labels resolved. Read live by the slash extension so a profile swap is
     * reflected without re-instantiating it.
     */
    private slashItems(): ReadonlyArray<SlashCommandItem> {
        const contributors = this.profileSlice()?.contributors ?? [];
        return buildSlashItems(contributors, (key) => this.translateLabel(key));
    }

    onSourceInput(text: string): void {
        this.content.set(text);
    }

    private toggleSourceMode(): void {
        if (this.sourceMode()) {
            // Source -> Visual: re-mount Tiptap with the (possibly edited)
            // storage content. mount() already pipes content through
            // adapter.toEditor(), so dtmpl tags re-hydrate into widget nodes.
            // setTimeout(0) defers past the next change-detection cycle so the
            // template's #editorMount @if branch is in the DOM and ViewChild
            // resolves before mount() reads it.
            this.sourceMode.set(false);
            setTimeout(() => void this.mount(), 0);
        } else {
            // Visual -> Source: capture editor HTML, run it back through the
            // adapter's toStorage() so the textarea displays the storage form
            // (e.g. `{widget:link:page:HEX label="..."}`) rather than the
            // editor's internal `<a data-widget="link">` markers. This keeps
            // the source view symmetric with what's actually persisted on
            // save and what arrives on the next load.
            if (this.tiptap) {
                const html = this.tiptap.getHTML();
                const adapter = this.contentAdapter();
                this.content.set(adapter ? adapter.toStorage(html) : html);
                this.tiptap.destroy();
                this.tiptap = undefined;
            }
            this.sourceMode.set(true);
        }
    }

    private async mount(): Promise<void> {
        if (this.sourceMode()) return;
        const host = this.editorMountRef?.nativeElement;
        if (!host) return;

        // Tear down any previous instance before re-mount (manifest swap, profile swap).
        this.tiptap?.destroy();
        host.innerHTML = '';

        const slice = this.profileSlice();
        const nodes = slice?.contributors ?? [];

        // Collect every Tiptap unit declared by every active contributor;
        // dedupe by extension name so two contributors needing the same
        // unit don't double-register. Foundation units are always present --
        // Tiptap requires document/paragraph/text/history and the editor
        // needs hardBreak to honor Shift+Enter (soft line break inside the
        // current block). The backend manifest doesn't enumerate them as
        // toolbar extensions.
        // `gapcursor` is foundation too, and its absence was a reported dead end
        //: a table inserted with nothing before or after it CANNOT be
        // escaped, because there is no text position on either side of it to put
        // a caret in. ProseMirror draws one there only if this plugin is loaded.
        // Not tied to the table contributor: the same trap belongs to every
        // isolating block the editor ships — a grid layout, a page break, a
        // code block — and any of them can be the first or last node.
        const names = new Set<string>(['document', 'paragraph', 'text', 'history', 'hardBreak', 'gapcursor']);
        for (const n of nodes) for (const e of n.extensions) names.add(e);
        const tiptapUnits = this.extensions.resolve(Array.from(names));

 // Editor-wide UX extensions — the `/`-command palette, the
        // drag-to-reorder gutter handle, and Word/Docs paste cleanup. Built here
        // rather than via the name registry because the slash palette needs
        // per-instance closures: the active profile's slashable entries and the
        // same action bridge a toolbar click uses, keeping the palette fully
        // manifest-driven. The slash menu offers commands only when the profile
        // actually has slashable contributors (`slashItems()` is empty
        // otherwise -> the trigger never opens).
        const uxUnits = [
            createSlashMenu({
                items:    () => this.slashItems(),
                onSelect: (node) => this.dispatchAction(node, null),
                injector: this.injector,
            }),
            createDragHandle(),
            createPasteCleanup(),
            createPagination(),
            // Always on, never profile-gated: an unregistered mark is not
            // inert, ProseMirror STRIPS what it cannot model, so a document
            // with fonts opened under a narrower profile would lose them
            // silently and save that way. The toolbar controls are gated
            // instead — see the mark's own note.
            CoolmsTextStyle,
            // The same rule, applied to the three things a stored DOCUMENT
            // carries and page content must not. Switched on by the
            // surface that edits documents; see `preserveDocumentFormatting`
            // for why this one is not simply always on too.
            ...(this.preserveDocumentFormatting()
                ? [
                    Underline, DocumentImageNode, FootnoteReferenceNode,
                    SectionBreakNode, CmsTextAlignExtension,
                ]
                : []),
        ];

        const adapter = this.contentAdapter();
        // Defense-in-depth: when the adapter implements stripDisallowedWidgets
        // (DtmplContentAdapter does), apply it before toEditor so the editor
        // never sees content the active profile would reject. Backend remains
        // authoritative on save; this just prevents a stale paste from
        // surfacing in the UI when the field's profile has been narrowed.
        const stored = this.content();
        const cleaned = adapter?.stripDisallowedWidgets
            ? adapter.stripDisallowedWidgets(stored, this.allowedWidgets())
            : stored;
        const initialContent = adapter
            ? await adapter.toEditor(cleaned)
            : cleaned;

        this.tiptap = new Editor({
            element:    host,
            extensions: [...tiptapUnits, ...uxUnits],
            content:    initialContent,
            onUpdate:   ({ editor }: { editor: Editor }) => {
                const html = editor.getHTML();
                const stored = adapter ? adapter.toStorage(html) : html;
                // Recorded BEFORE the write, so the effect the write wakes sees
                // it already claimed.
                this.selfEmitted = stored;
                this.content.set(stored);
                this.stateTick.update((t: number) => t + 1);
                // Typing changes where the breaks fall, so the paper behind the
                // text has to follow. After the DOM settles, or the
                // measurement reads the layout the keystroke just invalidated.
                this.schedulePaginate();
            },
            onSelectionUpdate: () => this.stateTick.update((t: number) => t + 1),
        });

        // Bump once on mount. `tiptap` is a plain field, so nothing that reads
        // it is reactive until the tick moves — without this the page counter
        // reads "1 / 1" on a freshly opened multi-page document and only
        // corrects itself after the first keystroke.
        this.stateTick.update((t: number) => t + 1);

        // Re-fit: source mode replaces the mount element, so the ViewChild the
        // fit reads is a different node than the one it last measured.
        this.fitSheet();

        // Detach prior chip-click listener (re-mount path) so we don't stack
        // duplicate handlers across content reloads.
        if (this.formFieldEditListener) {
            host.removeEventListener(FORM_FIELD_EDIT_EVENT, this.formFieldEditListener);
        }
        // Re-dispatch FormFieldNodeView's `cms-form-field-edit` event through
        // EditorActionRegistry. The NodeView has no DI access to build a
        // proper EditorActionContext; the host owns that responsibility.
        this.formFieldEditListener = (event: Event) => {
            const ce = event as CustomEvent<FormFieldEditEventDetail>;
            const editor = this.tiptap;
            if (!editor) return;
            const ctx: EditorActionContext = {
                editor,
                profile:          this.profile(),
                allowedWidgets:   this.allowedWidgets(),
                injector:         this.injector,
                toggleSourceMode: () => this.toggleSourceMode(),
                getContent:       () => this.content(),
                setContent:       (html) => this.content.set(html),
            };
            void this.actions.dispatch('formField.upsert', { attrs: ce.detail.attrs }, ctx);
        };
        host.addEventListener(FORM_FIELD_EDIT_EVENT, this.formFieldEditListener);
    }
}

/**
 * Built-in fallback labels used when the host app provides no translator.
 * Keeps the smoke-test toolbar readable without dragging in @ngx-translate.
 * Bridges with real i18n override via `EDITOR_TRANSLATE` provider.
 */
const BUILTIN_LABEL_FALLBACKS: Readonly<Record<string, string>> = {
    'editor.toolbar.format.bold':         'Bold',
    'editor.toolbar.format.italic':       'Italic',
    'editor.toolbar.format.link':         'Link',
    'editor.toolbar.format.strike':       'Strikethrough',
    'editor.toolbar.format.superscript':  'Superscript',
    'editor.toolbar.format.subscript':    'Subscript',
    'editor.toolbar.format.math':         'Insert math',
    'editor.toolbar.format.alignLeft':    'Align left',
    'editor.toolbar.format.alignCenter':  'Align centre',
    'editor.toolbar.format.alignRight':   'Align right',
    'editor.toolbar.format.alignJustify': 'Justify',
    'editor.toolbar.block.h1':            'Heading 1',
    'editor.toolbar.block.h2':            'Heading 2',
    'editor.toolbar.block.h3':            'Heading 3',
    'editor.toolbar.block.bulletList':    'Bullet list',
    'editor.toolbar.block.orderedList':   'Ordered list',
    'editor.toolbar.block.blockquote':    'Blockquote',
    'editor.toolbar.block.codeBlock':     'Code block',
    'editor.toolbar.block.codeTabs':      'Code tabs',
    'editor.toolbar.block.calloutNote':   'Note',
    'editor.toolbar.block.calloutWarning': 'Warning',
    'editor.toolbar.block.calloutTip':    'Tip',
    'editor.toolbar.block.calloutType':   'Callout type',
    'editor.toolbar.block.gridLayout':    'Insert grid',
    'editor.toolbar.block.table':         'Insert table',
    'editor.toolbar.block.embed':         'Embed',
    'editor.toolbar.block.form':          'Insert form',
    'editor.toolbar.block.document':      'Insert document',
    'editor.toolbar.block.imagemap':      'Insert image map',
    'editor.toolbar.block.pageBreak':     'Page break',
    'editor.toolbar.block.footnote':      'Insert footnote',
    'editor.toolbar.format.code':         'Inline code',
    'editor.toolbar.insert.formField':    'Insert form field',
    'editor.toolbar.insert.media':        'Insert media',
    'editor.toolbar.insert.media-gallery': 'Insert gallery',
    'editor.toolbar.meta.source':         'Source / HTML',
    'editor.toolbar.meta.importMarkdown': 'Import Markdown',
};
