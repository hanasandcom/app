import type { ReactNode } from 'react'
import { Alert, Image, Linking, Pressable, ScrollView, Text, View } from 'react-native'
import type { RootContent, PhrasingContent } from 'mdast'
import { useAppTheme } from '../theme/context'
import { markdownTree, openMarkdownLink, safeLink } from '../lib/markdown'

export type MarkdownCell = (offset: number | undefined, row: number, column: number) => string | undefined

export function MarkdownView({ source, evaluateCell }: { source: string; evaluateCell?: MarkdownCell }) {
    const theme = useAppTheme()
    const tree = markdownTree(source)
    const open = (url: string) => void openMarkdownLink(url, Linking.openURL, () => Alert.alert('Unable to open link', 'Check the address or try again later.'))
    const Caption = ({ children, muted = false }: { children?: ReactNode; muted?: boolean }) => <Text selectable style={{ color: muted ? theme.textMuted : theme.text, fontSize: 14, lineHeight: 21 }}>{children}</Text>
    const definitions = new Map(tree.children.filter(node => node.type === 'definition').map(node => [node.identifier.toLowerCase(), node.url]))
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
                onPress={url ? () => open(url) : undefined}
                style={{ color: theme.accentAlt, textDecorationLine: 'underline' }}
            >{node.children.map(inline)}</Text>
        }
        if (node.type === 'linkReference') {
            const target = definitions.get(node.identifier.toLowerCase())
            const url = target ? safeLink(target) : null
            return <Text key={index} accessibilityRole='link' onPress={url ? () => open(url) : undefined} style={{ color: theme.accentAlt, textDecorationLine: 'underline' }}>{node.children.map(inline)}</Text>
        }
        if (node.type === 'imageReference') {
            const target = definitions.get(node.identifier.toLowerCase())
            return <Text key={index}>{node.alt || 'Image'}{target && safeLink(target) ? ` (${target})` : ''}</Text>
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
                onPress={() => open(imageUrl)}
            >
                <Image source={{ uri: imageUrl }} style={{ width: '100%', height: 220 }} resizeMode='contain' />
                <Caption muted>{image?.alt}</Caption>
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
            <Caption>{item.checked === null || item.checked === undefined ? node.ordered ? `${(node.start || 1) + i}.` : '•' : item.checked ? '☑' : '☐'}</Caption>
            <View style={{ flex: 1, gap: 6 }}>{item.children.map(block)}</View>
        </View>)}</View>
        if (node.type === 'table') {
            return <ScrollView key={index} horizontal>
                <View>{node.children.map((row, r) => <View key={r} style={{ flexDirection: 'row' }}>{row.children.map((cell, c) => <Text
                    key={c}
                    selectable
                    style={{ color: theme.text, width: 180, padding: 10, borderWidth: 1, borderColor: theme.surfaceBorder, fontWeight: r === 0 ? '700' : '400' }}
                >{evaluateCell?.(node.position?.start.offset, r, c) ?? cell.children.map(inline)}</Text>)}</View>)}</View>
            </ScrollView>
        }
        if (node.type === 'thematicBreak') return <View key={index} style={{ height: 1, backgroundColor: theme.surfaceBorder }} />
        if (node.type === 'html') return /^<!--/.test(node.value) ? null : <Caption key={index}>{node.value}</Caption>
        return null
    }
    return <View style={{ gap: 14 }}>{tree.children.map(block)}</View>
}
