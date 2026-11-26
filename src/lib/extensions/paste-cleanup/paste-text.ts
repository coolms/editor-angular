import { Fragment, type Node as ProseMirrorNode, type ResolvedPos, type Schema, Slice } from '@tiptap/pm/model';

/** A blank line: a line break, then any run of lines holding only spaces or tabs, then a line break. */
const BLANK_LINE = /\n[ \t]*\n(?:[ \t]*\n)*/;

/**
 * Pasted plain text keeps its structure: a blank line starts a new paragraph and a single line break stays a line
 * break (a hard break) within one. Blank lines before the first paragraph and after the last are dropped. Inside a code
 * block the text goes in as it is. Null where the schema has no paragraph, so the editor's own parser applies.
 */
export function parsePastedText(text: string, schema: Schema, $context: ResolvedPos): Slice | null {
    const normalized = text.replace(/\r\n?/g, '\n');
    if ($context.parent.type.spec.code === true) {
        return normalized === '' ? Slice.empty : new Slice(Fragment.from(schema.text(normalized)), 0, 0);
    }
    const paragraph = schema.nodes['paragraph'];
    if (paragraph === undefined) return null;
    const hardBreak = schema.nodes['hardBreak'];
    const marks = $context.marks();
    const paragraphs: ProseMirrorNode[] = normalized
        .split(BLANK_LINE)
        .map(block => block.replace(/^\n+|\n+$/g, ''))
        .filter(block => block.trim() !== '')
        .map(block => {
            const inline: ProseMirrorNode[] = [];
            block.split('\n').forEach((line, i) => {
                if (i > 0) inline.push(hardBreak !== undefined ? hardBreak.create() : schema.text(' ', marks));
                if (line !== '') inline.push(schema.text(line, marks));
            });
            return paragraph.create(null, inline);
        });

    return paragraphs.length === 0 ? Slice.empty : Slice.maxOpen(Fragment.from(paragraphs));
}
