import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { CodeBlockLanguageNodeView, type CodeBlockLanguageOption } from './code-block-node-view';
import { dtmpl } from './dtmpl-highlight';

/**
 * One lowlight instance for the whole admin SPA: highlight.js' ~37 "common"
 * languages plus the platform's DTMPL grammar. Highlight state is per-decoration
 * (computed from the node's text on each transaction), not per-instance, so a
 * single shared registry is safe across every editor mount.
 */
const lowlight = createLowlight(common);
lowlight.register('dtmpl', dtmpl);

/** Display names for the picker; falls back to the raw highlight.js id. */
const LANG_LABELS: Readonly<Record<string, string>> = {
    bash: 'Bash', c: 'C', cpp: 'C++', csharp: 'C#', css: 'CSS', diff: 'Diff',
    go: 'Go', graphql: 'GraphQL', ini: 'INI / TOML', java: 'Java',
    javascript: 'JavaScript', json: 'JSON', kotlin: 'Kotlin', less: 'Less',
    lua: 'Lua', makefile: 'Makefile', markdown: 'Markdown', objectivec: 'Objective-C',
    perl: 'Perl', php: 'PHP', 'php-template': 'PHP template', python: 'Python',
    'python-repl': 'Python REPL', r: 'R', ruby: 'Ruby', rust: 'Rust', scss: 'SCSS',
    shell: 'Shell', sql: 'SQL', swift: 'Swift', typescript: 'TypeScript',
    vbnet: 'VB.NET', wasm: 'WebAssembly', xml: 'HTML / XML', yaml: 'YAML',
    arduino: 'Arduino', plaintext: 'Plain text', dtmpl: 'DTMPL',
};

function label(id: string): string {
    return LANG_LABELS[id] ?? id;
}

/**
 * Options for the in-block language dropdown: a no-highlight "Plain text" entry
 * first, DTMPL + Mermaid second (platform-first), then the registered common
 * languages alphabetically by display label.
 *
 * `mermaid` is NOT a highlight.js grammar — it's the diagram contract (Track B
 * #7): a `language-mermaid` block is rendered as a diagram by the public theme's
 * `mermaid-render.js` (and skipped by the highlighter). In the editor it shows
 * as plain diagram source in the code box; on the published page it paints.
 */
export function codeBlockLanguages(): ReadonlyArray<CodeBlockLanguageOption> {
    const rest = lowlight
        .listLanguages()
        .filter((id) => id !== 'dtmpl')
        .sort((a, b) => label(a).localeCompare(label(b)));
    return [
        { value: '', label: 'Plain text' },
        { value: 'dtmpl', label: 'DTMPL' },
        { value: 'mermaid', label: 'Mermaid (diagram)' },
        ...rest.map((id) => ({ value: id, label: label(id) })),
    ];
}

/**
 * The editor's `codeBlock` unit: CodeBlockLowlight (coloured tokens while
 * editing) + a NodeView that adds the language picker. Replaces the plain
 * `@tiptap/extension-code-block` registration from #788.
 *
 * Serialisation is unchanged from stock CodeBlock — `<pre><code class="language-x">`
 * with raw source — so existing stored content round-trips and the
 * HtmlProfileSanitizer keeps it verbatim.
 */
export function createCoolmsCodeBlock() {
    const options = codeBlockLanguages();
    return CodeBlockLowlight
        .extend({
            addNodeView() {
                return ({ node, editor, getPos }) =>
                    new CodeBlockLanguageNodeView(node, editor, getPos, options);
            },
        })
        .configure({ lowlight });
}
