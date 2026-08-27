/**
 * Public surface for `@coolms/editor-angular`.
 *
 * Monorepo-internal first (per design doc Section 5): consumed via tsconfig
 * path mapping from `packages/theme-admin/angular`. When the bridge
 * stabilises, we add a `package.json` here and publish to npm without code
 * changes — the public surface stays the same.
 */
export { CoolmsEditorComponent } from './lib/editor.component';
export type { PageGeometry, PageMargins } from './lib/editor.component';
export { FOOTNOTE_ATTRIBUTE } from './lib/extensions/footnote/footnote-reference-node';
export { provideCoolmsEditor } from './lib/providers/provide-coolms-editor';
export { provideCoolmsEditorFormField } from './lib/extensions/form-field/provide-form-field';
export { EditorActionRegistry } from './lib/registry/editor-action-registry';
export { EditorExtensionRegistry } from './lib/registry/editor-extension-registry';
export type {
    EditorActionContext,
    EditorActionHandler,
    ContentAdapter,
    EditorTranslate,
    EditorManifestProvider,
    EditorProfileManifest,
    EditorToolbarNodeManifest,
} from './lib/editor.types';
export { EDITOR_TRANSLATE, EDITOR_MANIFEST_PROVIDER } from './lib/editor.types';
export {
    formFieldDtmplToHtml, formFieldHtmlToDtmpl,
} from './lib/extensions/form-field/form-field-transform';
export {
    embedDtmplToHtml, embedHtmlToDtmpl,
} from './lib/extensions/embed/embed-widget-transform';
// The section-break marker, exported because the surface that edits a `.ddoc`
// joins the document's sections for editing and splits them apart again on
// save. A second copy of the literal would be a split that silently stops
// splitting the day the node changes.
export {
    SECTION_BREAK_HTML, SECTION_BREAK_PATTERN,
} from './lib/extensions/page-break/section-break-node';
// The font seam. The APPLICATION supplies the HTTP client, because the merged
// registry lives behind `/api/v1` and a package cannot reach that on its own --
// see `pagination/document-fonts.ts`.
export {
    useDocumentFontTransport, refreshDocumentFonts,
} from './lib/pagination/document-fonts';
export type { DocumentFontTransport } from './lib/pagination/document-fonts';
