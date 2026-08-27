import { Node, mergeAttributes } from '@tiptap/core';
import { CodeTabsNodeView } from './code-tabs-node-view';

/**
 * Container node grouping several language variants of the same snippet into a
 * tabbed code block. Saved shape:
 *
 *     <div class="code-tabs">
 *       <pre><code class="language-js">…</code></pre>
 *       <pre><code class="language-php">…</code></pre>
 *     </div>
 *
 * Plain Bootstrap-free HTML (no `{widget:…}` tag) — like gridLayout, it rides
 * the content path's widget-axis-only ContentSanitizer untouched. The public
 * theme enhances it into real tabs; without JS the variants stack and stay
 * readable.
 */
export const CodeTabsNode = Node.create({
    name: 'codeTabs',
    group: 'block',
    content: 'codeBlock+',
    isolating: true,
    defining: true,

    parseHTML() {
        return [{ tag: 'div.code-tabs', priority: 100 }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { class: 'code-tabs' }), 0];
    },

    addNodeView() {
        return ({ node }) => new CodeTabsNodeView(node);
    },
});
