import { useMemo, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg'
import { PillButton } from '../../components/ui'
import { useAppTheme } from '../../theme/context'
import type { SourceNode } from './api'
import { Actions, ThesisField, ThesisText } from './ui'

export function dependencyNeighborhood(nodes: SourceNode[], selected: string, limit: number) {
    const byId = new Map(nodes.map(node => [node.id, node]))
    const focus = byId.get(selected)
    if (!focus) return { focus: null, dependencies: [], dependents: [] }
    return { focus, dependencies: focus.dependencies.map(id => byId.get(id)).filter((node): node is SourceNode => !!node).slice(0, limit), dependents: nodes.filter(node => node.dependencies.includes(selected)).slice(0, limit) }
}
export function DependencyGraph({ nodes, selected, onSelect }: { nodes: SourceNode[]; selected: string; onSelect: (id: string) => void }) {
    const theme = useAppTheme()
    const [zoom, setZoom] = useState(1), [limit, setLimit] = useState(12), [overview, setOverview] = useState(false), [expanded, setExpanded] = useState(false), [query, setQuery] = useState('')
    const horizontal = useRef<ScrollView>(null), vertical = useRef<ScrollView>(null)
    const model = useMemo(() => dependencyNeighborhood(nodes, selected, limit), [nodes, selected, limit])
    const summary = overview || !model.focus
    const positioned = summary ? nodes.slice(0, limit).map((node, index) => ({ node, x: (index % 3) * 310 + 10, y: Math.floor(index / 3) * 80 + 20 })) : [
        { node: model.focus!, x: 330, y: 40 },
        ...model.dependents.map((node, i) => ({ node, x: 10, y: i * 80 + 40 })),
        ...model.dependencies.map((node, i) => ({ node, x: 650, y: i * 80 + 40 })),
    ]
    const byId = new Map(positioned.map(node => [node.node.id, node]))
    const height = Math.max(240, ...positioned.map(node => node.y + 90))
    function focus(id: string) { onSelect(id); setOverview(false); setZoom(1); horizontal.current?.scrollTo({ x: 0, animated: false }); vertical.current?.scrollTo({ y: 0, animated: false }) }
    return <View style={{ gap: 10 }}>
        <ThesisText heading>Dependency diagram</ThesisText>
        <ThesisText muted>Source declarations, not production activity. Computed requests, unresolved references and non-JavaScript dependencies need manual inspection.</ThesisText>
        <Actions><PillButton label={summary ? 'Selected connections' : 'Overview'} onPress={() => setOverview(!summary)} /><PillButton label='Zoom in' onPress={() => setZoom(z => Math.min(4, z * 1.25))} /><PillButton label='Zoom out' onPress={() => setZoom(z => Math.max(0.25, z / 1.25))} /><PillButton label='Reset zoom' onPress={() => setZoom(1)} /><PillButton label={expanded ? 'Minimize diagram' : 'Expand diagram'} onPress={() => setExpanded(!expanded)} /><PillButton label='More connections' onPress={() => setLimit(v => Math.min(200, v + 12))} /></Actions>
        <ThesisField label='Find source in diagram' value={query} onChange={setQuery} />
        {!!query.trim() && <Actions>{nodes.filter(node => (node.title + ' ' + node.file).toLowerCase().includes(query.toLowerCase())).slice(0, 20).map(node => <PillButton key={node.id} label={node.title} onPress={() => { focus(node.id); setQuery('') }} />)}</Actions>}
        <ScrollView ref={vertical} style={{ height: expanded ? 620 : 330 }} nestedScrollEnabled>
            <ScrollView ref={horizontal} horizontal nestedScrollEnabled>
                <Svg width={970 * zoom} height={height * zoom} viewBox={`0 0 970 ${height}`} accessibilityLabel='Source dependency diagram'>
                    {positioned.flatMap(from => from.node.dependencies.filter(id => byId.has(id)).map(id => { const to = byId.get(id)!; return <Line key={`${from.node.id}:${id}`} x1={from.x + 140} y1={from.y + 25} x2={to.x + 140} y2={to.y + 25} stroke={theme.accentAlt} strokeWidth={1.5} /> }))}
                    {positioned.map(({ node, x, y }) => <G key={node.id} onPress={() => focus(node.id)} accessibilityLabel={`Select source ${node.title}`}><Rect x={x} y={y} width={280} height={52} rx={8} fill={theme.surfaceStrong} stroke={selected === node.id ? theme.accent : theme.surfaceBorder} /><SvgText x={x + 10} y={y + 22} fill={theme.text} fontSize={12}>{node.title.slice(0, 35)}</SvgText><SvgText x={x + 10} y={y + 40} fill={theme.textMuted} fontSize={10}>{node.kind} · {node.dependencies.length} dependencies</SvgText></G>)}
                </Svg>
            </ScrollView>
        </ScrollView>
    </View>
}
