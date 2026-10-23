import { useMemo, useRef, useState } from 'react'
import { PanResponder, Text, View } from 'react-native'
import Svg, { Circle, G, Path } from 'react-native-svg'
import { PillButton } from './ui'
import { useAppTheme } from '../theme/context'
import { countryCentroids, projectTrafficPoint, trafficWorldPaths, type CountryTraffic } from '../data/traffic-geography'

export type TrafficPing = { id: number; iso: string; count: number; at: number }
type Box = { x: number; y: number; width: number; height: number }
const initial: Box = { x: 0, y: 0, width: 1000, height: 500 }
function clamp(box: Box): Box { const width = Math.max(200, Math.min(1000, box.width)), height = width / 2; return { width, height, x: Math.max(0, Math.min(1000 - width, box.x)), y: Math.max(0, Math.min(500 - height, box.y)) } }
export function TrafficMap({ countries, selected, onSelect, pings, now }: { countries: CountryTraffic[]; selected: string; onSelect: (iso: string) => void; pings: TrafficPing[]; now: number }) {
    const theme = useAppTheme(), [box, setBox] = useState(initial), [width, setWidth] = useState(320)
    const current = useRef(box), dimensions = useRef(width), drag = useRef(initial)
    current.current = box; dimensions.current = width
    const pan = useMemo(() => PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => current.current.width < 1000 && Math.abs(gesture.dx) + Math.abs(gesture.dy) > 12,
        onPanResponderGrant: () => { drag.current = current.current },
        onPanResponderMove: (_, gesture) => setBox(clamp({ ...drag.current, x: drag.current.x - gesture.dx * drag.current.width / dimensions.current, y: drag.current.y - gesture.dy * drag.current.width / dimensions.current })),
    }), [])
    const strongest = Math.max(1, ...countries.map(country => country.count))
    function zoom(factor: number) { setBox(value => { const nextWidth = Math.max(200, Math.min(1000, value.width * factor)); return clamp({ x: value.x + (value.width - nextWidth) / 2, y: value.y + (value.height - nextWidth / 2) / 2, width: nextWidth, height: nextWidth / 2 }) }) }
    function choose(iso: string) { onSelect(iso); const coords = countryCentroids[iso]; if (coords) { const [x, y] = projectTrafficPoint(coords); setBox(clamp({ x: x - 180, y: y - 90, width: 360, height: 180 })) } }
    return <View style={{ gap: 10 }}>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>Country dots show located requests in the latest snapshot. Rings mark incoming live batches. Zoom, then drag to pan.</Text>
        <View onLayout={event => setWidth(event.nativeEvent.layout.width)} {...pan.panHandlers} style={{ aspectRatio: 2, overflow: 'hidden', borderRadius: 12, backgroundColor: theme.background }}>
            <Svg width='100%' height='100%' viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} accessibilityLabel='World traffic map; use the country buttons below for accessible details'>
                {trafficWorldPaths.map((d, index) => <Path key={index} d={d} fill={theme.ambientNeutral} stroke={theme.surfaceBorderSoft} strokeWidth={0.8} />)}
                {countries.map(country => { const [x, y] = projectTrafficPoint(countryCentroids[country.iso]); return <G key={country.iso} onPress={() => choose(country.iso)}><Circle cx={x} cy={y} r={4 + 8 * country.count / strongest} fill={theme.textMuted} opacity={selected === country.iso ? 1 : 0.6} stroke={theme.text} strokeWidth={selected === country.iso ? 2 : 0.5} /></G> })}
                {pings.filter(ping => now - ping.at < 2200 && countryCentroids[ping.iso]).map(ping => { const [x, y] = projectTrafficPoint(countryCentroids[ping.iso]); const progress = Math.max(0, Math.min(1, (now - ping.at) / 2200)); return <Circle key={ping.id} cx={x} cy={y} r={8 + progress * 22} fill='none' stroke={theme.text} opacity={1 - progress} strokeWidth={1.5} /> })}
            </Svg>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><PillButton small label='Zoom in' onPress={() => zoom(0.8)} /><PillButton small label='Zoom out' onPress={() => zoom(1.25)} /><PillButton small label='Reset map' onPress={() => setBox(initial)} /></View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{countries.map(country => <PillButton small key={country.iso} label={`${country.iso}: ${country.count}`} tone={selected === country.iso ? 'accent' : 'default'} onPress={() => choose(country.iso)} />)}</View>
    </View>
}
