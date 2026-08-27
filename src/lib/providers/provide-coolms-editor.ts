import { APP_INITIALIZER, Injector, Optional, type Provider } from '@angular/core';
import Bold from '@tiptap/extension-bold';
import Code from '@tiptap/extension-code';
import Italic from '@tiptap/extension-italic';
import Strike from '@tiptap/extension-strike';
import Heading from '@tiptap/extension-heading';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import Blockquote from '@tiptap/extension-blockquote';
import Link from '@tiptap/extension-link';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import History from '@tiptap/extension-history';
import { Gapcursor } from '@tiptap/extension-gapcursor';
import { CmsTable } from '../extensions/table/table-node';
import { CmsHardBreak } from '../extensions/page-break/hard-break-node';
import { CmsTableRow } from '../extensions/table/table-row';
import { CmsFootnoteInsertHandler } from '../extensions/footnote/footnote-insert.handler';
import { CmsTextAlignSetHandler } from '../actions/cms-text-align-set.handler';
import { EditorOpenLinkDialogHandler } from '../actions/editor-open-link-dialog.handler';
import { EditorToggleSourceModeHandler } from '../actions/editor-toggle-source-mode.handler';
import { TiptapSetHeadingHandler } from '../actions/tiptap-set-heading.handler';
import { TiptapToggleMarkHandler } from '../actions/tiptap-toggle-mark.handler';
import { TiptapToggleNodeHandler } from '../actions/tiptap-toggle-node.handler';
import { GridLayoutInsertHandler } from '../extensions/grid-layout/grid-layout-insert.handler';
import {
    GridColumnNode, GridLayoutNode, GridRowNode,
} from '../extensions/grid-layout/grid-layout-nodes';
import { createCoolmsCodeBlock } from '../extensions/code-block/code-block-lowlight';
import { CodeTabsInsertHandler } from '../extensions/code-block/code-tabs-insert.handler';
import { CodeTabsNode } from '../extensions/code-block/code-tabs-node';
import { SubscriptMark, SuperscriptMark } from '../extensions/script-marks';
import { TableInsertHandler } from '../extensions/table/table-insert.handler';
import { TableCommandHandler } from '../extensions/table/table-command.handler';
import { CmsTableCell, CmsTableHeader } from '../extensions/table/table-cell';
import { createTableControls } from '../extensions/table/table-controls';
import { CalloutInsertHandler } from '../extensions/callout/callout-insert.handler';
import { CalloutNode } from '../extensions/callout/callout-node';
import { EmbedInsertHandler } from '../extensions/embed/embed-insert.handler';
import { DtmplEmbedNode } from '../extensions/embed/dtmpl-embed-node';
import { MathInsertHandler } from '../extensions/math/math-insert.handler';
import { PageBreakInsertHandler } from '../extensions/page-break/page-break-insert.handler';
import { MathNode } from '../extensions/math/math-node';
import { PageBreakNode } from '../extensions/page-break/page-break-node';
import { CmsTextAlignExtension } from '../extensions/align/text-align-extension';
import { EditorActionRegistry } from '../registry/editor-action-registry';
import { EditorExtensionRegistry } from '../registry/editor-extension-registry';
import { EDITOR_TRANSLATE, type EditorTranslate } from '../editor.types';

/**
 * Bootstrap providers for `@coolms/editor-angular`. Consumers add this to
 * their `ApplicationConfig.providers` once.
 *
 * Side effects on app boot:
 *   1. Registers the built-in action handlers (`tiptap.toggleMark`,
 *      `tiptap.toggleNode`, `tiptap.setHeading`, `editor.toggleSourceMode`,
 *      `editor.openLinkDialog`, `gridLayout.insert`, `table.insert`).
 *   2. Registers built-in Tiptap extensions under their canonical names so
 *      the manifest's `extensions` strings resolve at editor mount.
 *
 * Module-supplied handlers + extensions (Media insert in C2, future
 * Taxonomy link decoration) register via their own APP_INITIALIZER alongside
 * this one — multi: true means everything composes additively.
 */
export function provideCoolmsEditor(): Provider[] {
    return [
        {
            provide: APP_INITIALIZER,
            multi:   true,
            // EDITOR_TRANSLATE is optional (no provider wired today) — the
            // callout NodeView falls back to English labels when it's null.
            deps:    [EditorActionRegistry, EditorExtensionRegistry, Injector, [new Optional(), EDITOR_TRANSLATE]],
            useFactory: (
                actions: EditorActionRegistry,
                extensions: EditorExtensionRegistry,
                injector: Injector,
                translate: EditorTranslate | null,
            ) => () => {
                // ── Action handlers ─────────────────────────────────────
                actions.register('tiptap.toggleMark',        new TiptapToggleMarkHandler());
                actions.register('tiptap.toggleNode',        new TiptapToggleNodeHandler());
                actions.register('tiptap.setHeading',        new TiptapSetHeadingHandler());
                actions.register('editor.toggleSourceMode',  new EditorToggleSourceModeHandler());
                actions.register('editor.openLinkDialog',    new EditorOpenLinkDialogHandler());
                actions.register('gridLayout.insert',        new GridLayoutInsertHandler());
                actions.register('table.insert',             new TableInsertHandler());
                // Generic in-table editing ops (add/remove row+col, merge/split,
                // toggle header, column alignment) — the table bubble-menu
                // dispatches `params.command` through this handler.
                actions.register('tiptap.tableCommand',      new TableCommandHandler());
                actions.register('codeTabs.insert',          new CodeTabsInsertHandler());
                actions.register('callout.insert',           new CalloutInsertHandler());
                actions.register('embed.insert',             new EmbedInsertHandler());
                actions.register('math.insert',              new MathInsertHandler());
                actions.register('pageBreak.insert',         new PageBreakInsertHandler());
                // One handler for four buttons; they differ only by the
                // 'align' action parameter (#2292).
                actions.register('cmsTextAlign.set',         new CmsTextAlignSetHandler());
                actions.register('cmsFootnote.insert',       new CmsFootnoteInsertHandler());

                // ── Tiptap extensions (canonical names from PHP manifest)
                // Document/Paragraph/Text/History always register — Tiptap
                // requires them as the editor's foundation. The other
                // entries are toolbar-driven; if no built-in references one
                // (e.g. nobody enabled lists), the resolver simply won't
                // pick the factory.
                extensions.register('document',    () => Document);
                extensions.register('paragraph',   () => Paragraph);
                extensions.register('text',        () => Text);
                // hardBreak enables Shift+Enter -> `<br>` (soft line break)
                // inside the current block. Always seeded by editor.component.
                // CmsHardBreak, not the stock unit: it carries the
                // `data-page-break` marker a page break INSIDE a paragraph
                // needs, which OOXML puts in a run and a block atom cannot
                // express (#2289).
                extensions.register('hardBreak',   () => CmsHardBreak);
                extensions.register('history',     () => History);
                // The caret ProseMirror draws where no text position exists —
                // beside a table, a grid, a page break. Seeded unconditionally
                // by editor.component: without it a block at the very start or
                // end of the document is a dead end with no way to type past it.
                extensions.register('gapcursor',   () => Gapcursor);
                extensions.register('bold',        () => Bold);
                extensions.register('italic',      () => Italic);
                extensions.register('strike',      () => Strike);
                extensions.register('superscript', () => SuperscriptMark);
                extensions.register('subscript',   () => SubscriptMark);
                // Inline code mark (`<code>`) — stock Tiptap unit; its
                // toggleMark action resolves via the generic handler.
                extensions.register('code',        () => Code);
                // Fenced code block (`<pre><code class="language-…">`). The
                // lowlight build (#788 Track B) adds coloured tokens while
                // editing + an in-block language picker; serialisation stays
                // raw source so getHTML() is sanitiser-clean.
                extensions.register('codeBlock',   () => createCoolmsCodeBlock());
                // Multi-language code tabs — container of codeBlock+ rendered
                // as a tabbed `<div class="code-tabs">`.
                extensions.register('codeTabs',    () => CodeTabsNode);
                extensions.register('heading',     () => Heading);
                extensions.register('bulletList',  () => BulletList);
                extensions.register('orderedList', () => OrderedList);
                extensions.register('listItem',    () => ListItem);
                extensions.register('blockquote',  () => Blockquote);
                extensions.register('link',        () => Link.configure({ openOnClick: false }));
                // Grid layout primitives — three factories because the
                // EditorExtensionRegistry maps one name to one Tiptap unit
                // and gridLayout / gridRow / gridColumn are three nodes.
                // The contributor declares all three in `extensions:` so
                // they all load together at editor mount time.
                extensions.register('gridLayout',  () => GridLayoutNode);
                extensions.register('gridRow',     () => GridRowNode);
                extensions.register('gridColumn',  () => GridColumnNode);
                // Tabular-data primitives — Tiptap's stock table extensions.
                // `Table.configure({ resizable: true })` enables column
                // resize handles built into the extension; behaviour mirrors
                // the gridColumn resize NodeView at the table level. The cell +
                // header units are the `CmsTableCell` / `CmsTableHeader`
                // subclasses that add the `align` attribute (column alignment
                // → Bootstrap `text-*` class; no inline style).
                // CmsTable, not the stock unit: it adds the table's own width,
                // border and cell-margin attributes, without which a
                // borderless imported table grows borders on its first save
                // (#2289).
                extensions.register('table',       () => CmsTable.configure({ resizable: true }));
                // CmsTableRow, not the stock TableRow: it adds the `height`
                // attribute a `w:trHeight` is written from (#2086).
                extensions.register('tableRow',    () => CmsTableRow);
                extensions.register('tableHeader', () => CmsTableHeader);
                extensions.register('tableCell',   () => CmsTableCell);
                // In-table editing UX: a bubble menu (add/remove row+col,
                // merge/split, toggle header, column alignment, delete table)
                // shown via a CDK overlay whenever the caret is inside a table.
                // Declared by the `block:table` contributor's `extensions:` so
                // it loads exactly when tables are enabled. Needs the Angular
                // injector to reach CDK Overlay from the ProseMirror plugin.
                extensions.register('tableControls', () => createTableControls(injector));
                // Callout / admonition block (note · warning · tip) — one node,
                // three `callout:*` toolbar buttons insert each kind. The
                // NodeView renders a localized, iconed title + an in-place type
                // switcher; `translate` localizes those labels (null → English).
                extensions.register('callout',     () => CalloutNode.configure({ translate }));
                // Video embed (YouTube / Vimeo) — `block:embed` toolbar button
                // opens a URL dialog; the node round-trips through the
                // {widget:embed:video …} dtmpl transform (server resolves the
                // safe canonical iframe at render time).
                extensions.register('dtmplEmbed',  () => DtmplEmbedNode);
                // Inline math atom (Track B #7) — `format:math` toolbar button opens
                // a LaTeX dialog; the node stores the same `.katex-src` span the
                // server's MathProcessor emits, and a NodeView shows a live KaTeX
                // preview while editing. KaTeX is lazy-imported by the NodeView.
                extensions.register('math',        () => MathNode);
                // Explicit page break (#1770) — an atom rendering
                // <hr data-page-break>, which PageBreakMapper turns into a real
                // DOCX page break. Deliberately NOT the built-in horizontal rule:
                // that is a visible divider, and reusing it would make every
                // decorative rule in existing documents start a new page.
                extensions.register('pageBreak',   () => PageBreakNode);
                // Paragraph alignment. Named here so a profile's 'extensions'
                // entry resolves, and ALSO loaded unconditionally by
                // editor.component when a document is being edited -- the
                // schema has to hold an alignment even where no toolbar offers
                // one, or opening a centred document loses the centring.
                extensions.register('cmsTextAlign', () => CmsTextAlignExtension);
            },
        },
    ];
}
