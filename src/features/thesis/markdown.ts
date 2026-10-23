import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import type { Root, RootContent, TableCell } from 'mdast'

export function markdownTree(source: string): Root {
    return fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
}

// The website workspace codec consumes block offsets and raw GFM cell contents.
// AST positions distinguish actual tables/comments from fenced examples.
export function markdownBlocks(source: string) {
    return markdownTree(source).children.map((node: RootContent) => {
        const start = node.position?.start.offset ?? 0
        let end = node.position?.end.offset ?? start
        if (source[end] === '\n') end++
        const cell = (value: TableCell) => {
            const first = value.children[0]?.position?.start.offset
            const last = value.children.at(-1)?.position?.end.offset
            return { text: first === undefined || last === undefined ? '' : source.slice(first, last) }
        }
        return {
            type: node.type,
            raw: source.slice(start, end),
            header: node.type === 'table' ? node.children[0].children.map(cell) : [],
            rows: node.type === 'table' ? node.children.slice(1).map(row => row.children.map(cell)) : [],
        }
    })
}

export function safeLink(value: string) {
    try {
        const url = new URL(value)
        return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? value : null
    } catch { return null }
}
