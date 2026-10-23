import { MarkdownView as NativeMarkdown } from '../../components/MarkdownView'
import { cellValue, tables } from './workspace'

/** Formula evaluation belongs only to Thesis; ordinary Markdown remains literal. */
export function MarkdownView({ source }: { source: string }) {
    const parsed = tables(source)
    return <NativeMarkdown source={source} evaluateCell={(offset, row, column) => {
        const data = parsed.find(table => table.start === offset)?.data
        const value = data?.cells[row]?.[column]
        return data && value && /^=SUMMARIZE\b/i.test(value.trim()) ? cellValue(data.cells, row, column) : undefined
    }} />
}
