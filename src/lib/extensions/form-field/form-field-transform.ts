/**
 * Bidirectional HTML <-> dtmpl transform for the FormFieldNode Tiptap atom.
 *
 * On save:  formFieldHtmlToDtmpl rewrites every
 *           `<span data-widget="formField" data-field-id=… …></span>` marker
 *           into its `{widget:formField:fieldId …}` source form.
 * On load:  formFieldDtmplToHtml does the inverse, rebuilding marker spans
 *           so Tiptap's parseHTML can rehydrate FormFieldNode instances.
 *
 * The pair is required to be lossless for the supported attribute set
 * (modulo attribute ordering inside the widget tag) so a save/reload cycle
 * never mutates user content.
 *
 * JSON-shaped attributes (`validation`, `visibility`) are stored as
 * base64-encoded JSON because the dtmpl widget body regex `[^}]+` cannot
 * carry literal `}` characters in param values. base64 alphabet is
 * URL-safe-enough (no `}`) and survives the quoted-value regex untouched.
 *
 * Storage limitations (matching the link/media transform conventions):
 *   - `}` characters inside string param values break the body regex.
 *     The picker is responsible for not producing such values for plain
 *     string attributes; structured payloads use base64 to sidestep.
 */

const FORM_FIELD_SPAN_RE = /<span\b[^>]*\bdata-widget=(["'])formField\1[^>]*><\/span>/gi;
const FORM_FIELD_WIDGET_TAG_RE = /\{widget:formField:([A-Za-z0-9_]+)(?:\s+([^}]*))?\}/g;
const ATTR_RE = (name: string) =>
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');

function matchAttr(html: string, name: string): string | null {
    const m = ATTR_RE(name).exec(html);
    if (!m) return null;
    return m[1] ?? m[2] ?? m[3] ?? null;
}

/** Quote-escape for use inside a double-quoted dtmpl param value. */
function escapeQuote(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** HTML-attribute escape for the inverse path. */
function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Parse a dtmpl widget params string into a plain key/value map. Identical
 * convention to media-widget-transform / link-widget-transform parseParams
 * so storage syntax stays uniform across widget kinds.
 */
function parseParams(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /(\w[\w-]*)\s*=\s*(?:"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|([^\s}]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        const key = m[1];
        let val = m[2] ?? m[3] ?? m[4] ?? '';
        if (m[2] !== undefined) val = val.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        else if (m[3] !== undefined) val = val.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        out[key] = val;
    }
    return out;
}

const FIELD_ID_RE = /^[A-Za-z0-9_]+$/;

/**
 * Convert editor HTML into stored dtmpl. Walks every marker
 * `<span data-widget="formField" …></span>` and emits the corresponding
 * `{widget:formField:fieldId …}` tag. Spans without a usable fieldId pass
 * through unchanged so source-mode editing doesn't silently drop content
 * authored against a future schema.
 */
export function formFieldHtmlToDtmpl(html: string): string {
    return html.replace(FORM_FIELD_SPAN_RE, (match) => {
        const fieldIdRaw = matchAttr(match, 'data-field-id');
        if (!fieldIdRaw || !FIELD_ID_RE.test(fieldIdRaw)) return match;

        const type         = matchAttr(match, 'data-type') ?? 'text';
        const label        = matchAttr(match, 'data-label') ?? '';
        const required     = matchAttr(match, 'data-required') === 'true';
        const placeholder  = matchAttr(match, 'data-placeholder');
        const defaultValue = matchAttr(match, 'data-default-value');
        const validation   = matchAttr(match, 'data-validation');
        const datasource   = matchAttr(match, 'data-datasource');
        const visibility   = matchAttr(match, 'data-visibility');

        const params: string[] = [`type=${type}`];
        if (label !== '')                            params.push(`label="${escapeQuote(label)}"`);
        if (required)                                params.push(`required=true`);
        if (placeholder !== null && placeholder !== '')
                                                     params.push(`placeholder="${escapeQuote(placeholder)}"`);
        if (defaultValue !== null && defaultValue !== '')
                                                     params.push(`defaultValue="${escapeQuote(defaultValue)}"`);
        if (validation !== null && validation !== '') params.push(`validation="${escapeQuote(validation)}"`);
        if (datasource !== null && datasource !== '') params.push(`datasource="${escapeQuote(datasource)}"`);
        if (visibility !== null && visibility !== '') params.push(`visibility="${escapeQuote(visibility)}"`);

        return `{widget:formField:${fieldIdRaw} ${params.join(' ')}}`;
    });
}

/**
 * Convert stored dtmpl into editor HTML. Each `{widget:formField:fieldId …}`
 * becomes a `<span data-widget="formField" data-field-id=… …></span>` marker
 * the FormFieldNode parseHTML rule rehydrates into a Tiptap atom node. Tags
 * with a malformed fieldId (anything outside `[A-Za-z0-9_]+`) pass through
 * verbatim so authors can spot and fix them in source view.
 */
export function formFieldDtmplToHtml(content: string): string {
    return content.replace(FORM_FIELD_WIDGET_TAG_RE, (full, fieldId: string, paramsStr: string | undefined) => {
        if (!FIELD_ID_RE.test(fieldId)) return full;
        const params = parseParams(paramsStr ?? '');

        const type         = params['type']         ?? 'text';
        const label        = params['label']        ?? '';
        const required     = params['required']     === 'true';
        const placeholder  = params['placeholder']  ?? '';
        const defaultValue = params['defaultValue'] ?? '';
        const validation   = params['validation']   ?? '';
        const datasource   = params['datasource']   ?? '';
        const visibility   = params['visibility']   ?? '';

        const dataAttrs: string[] = [
            ` data-widget="formField"`,
            ` data-field-id="${escapeAttr(fieldId)}"`,
            ` data-type="${escapeAttr(type)}"`,
            ` data-label="${escapeAttr(label)}"`,
            ` data-required="${required ? 'true' : 'false'}"`,
        ];
        if (placeholder  !== '') dataAttrs.push(` data-placeholder="${escapeAttr(placeholder)}"`);
        if (defaultValue !== '') dataAttrs.push(` data-default-value="${escapeAttr(defaultValue)}"`);
        if (validation   !== '') dataAttrs.push(` data-validation="${escapeAttr(validation)}"`);
        if (datasource   !== '') dataAttrs.push(` data-datasource="${escapeAttr(datasource)}"`);
        if (visibility   !== '') dataAttrs.push(` data-visibility="${escapeAttr(visibility)}"`);

        const cls = required ? 'cms-form-field cms-form-field--required' : 'cms-form-field';
        return `<span${dataAttrs.join('')} class="${cls}"></span>`;
    });
}
