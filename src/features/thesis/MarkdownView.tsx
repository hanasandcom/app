import type { ReactNode } from 'react'
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native'
import type { RootContent, PhrasingContent } from 'mdast'
import { useAppTheme } from '../../theme/context'
import { markdownTree, safeLink } from './markdown'
import { ThesisText } from './ui'
import { cellValue, tables } from './workspace'

export function MarkdownView({ source }: { source: string }) {
    const theme = useAppTheme()
    const tree = markdownTree(source)
    const parsedTables = tables(source)
    function inline(node: PhrasingContent, index: number): ReactNode {
        if (node.type === 'text') return node.value
        if (node.type === 'inlineCode') return <Text key={index} style={{ fontFamily: 'Courier', backgroundColor: theme.surfaceStrong }}>{node.value}</Text>
        if (node.type === 'break') return '\n'
        if (node.type === 'html') return <Text key={index}>{node.value}</Text>
        if (node.type === 'image') {
            const url = safeLink(node.url)
            return <Text key={index}>{node.alt || 'Image'}{url ? ` (${url})` : ''}</Text>
        }
        if (node.type === 'link') {
            const url = safeLink(node.url)
            return <Text
                key={index}
                accessibilityRole='link'
                onPress={url ? () => void Linking.openURL(url) : undefined}
                style={{ color: theme.accentAlt, textDecorationLine: 'underline' }}
            >{node.children.map(inline)}</Text>
        }
        if ('children' in node) return <Text
            key={index}
            style={{ fontWeight: node.type === 'strong' ? '700' : '400', fontStyle: node.type === 'emphasis' ? 'italic' : 'normal', textDecorationLine: node.type === 'delete' ? 'line-through' : 'none' }}
        >{node.children.map(inline)}</Text>
        return null
    }
    function block(node: RootContent, index: number): ReactNode {
        if (node.type === 'paragraph' || node.type === 'heading') {
            const image = node.type === 'paragraph' && node.children.length === 1 && node.children[0].type === 'image' ? node.children[0] : null
            const imageUrl = image && safeLink(image.url)
            if (imageUrl && imageUrl.startsWith('https:')) return <Pressable
                key={index}
                accessibilityLabel={image?.alt || 'Open image'}
                onPress={() => void Linking.openURL(imageUrl)}
            >
                <Image source={{ uri: imageUrl }} style={{ width: '100%', height: 220 }} resizeMode='contain' />
                <ThesisText muted>{image?.alt}</ThesisText>
            </Pressable>
            return <Text
                key={index}
                selectable
                style={{ color: theme.text, fontSize: node.type === 'heading' ? Math.max(16, 28 - node.depth * 2) : 15, lineHeight: 24, fontWeight: node.type === 'heading' ? '700' : '400' }}
            >{node.children.map(inline)}</Text>
        }
        if (node.type === 'code') return <ScrollView horizontal key={index}>
            <Text
                selectable
                style={{ color: theme.text, fontFamily: 'Courier', padding: 12, backgroundColor: theme.surfaceStrong }}
            >{node.value}</Text>
        </ScrollView>
        if (node.type === 'blockquote') return <View key={index} style={{ borderLeftWidth: 3, borderLeftColor: theme.accentAlt, paddingLeft: 12, gap: 8 }}>{node.children.map(block)}</View>
        if (node.type === 'list') return <View key={index} style={{ gap: 8 }}>{node.children.map((item, i) => <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
            <ThesisText>{item.checked === null || item.checked === undefined ? node.ordered ? `${(node.start || 1) + i}.` : '•' : item.checked ? '☑' : '☐'}</ThesisText>
            <View style={{ flex: 1, gap: 6 }}>{item.children.map(block)}</View>
        </View>)}</View>
        if (node.type === 'table') {
            const data = parsedTables.find(table => table.start === node.position?.start.offset)?.data
            return <ScrollView key={index} horizontal>
                <View>{node.children.map((row, r) => <View key={r} style={{ flexDirection: 'row' }}>{row.children.map((cell, c) => <Text
                    key={c}
                    selectable
                    style={{ color: theme.text, width: 180, padding: 10, borderWidth: 1, borderColor: theme.surfaceBorder, fontWeight: r === 0 ? '700' : '400' }}
                >{data ? cellValue(data.cells, r, c) : cell.children.map(inline)}</Text>)}</View>)}</View>
            </ScrollView>
        }
        if (node.type === 'thematicBreak') return <View key={index} style={{ height: 1, backgroundColor: theme.surfaceBorder }} />
        if (node.type === 'html') return /^<!--/.test(node.value) ? null : <ThesisText key={index}>{node.value}</ThesisText>
        return null
    }
    return <View style={{ gap: 14 }}>{tree.children.map(block)}</View>
}
