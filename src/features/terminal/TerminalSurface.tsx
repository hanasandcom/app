import { useEffect, useRef, useState } from 'react'
import { AppState, Platform, Pressable, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from 'react-native'
import { PillButton } from '../../components/ui'
import { useAppTheme } from '../../theme/context'
import type { TerminalChannel } from './channel'
import { CELL_BACKGROUND, type TerminalCell } from './cells'
import { TerminalInputFence } from './input'
import { TerminalEngine, type TerminalKey, type TerminalSnapshot } from './engine'

const FONT_SIZE = 13
const LINE_HEIGHT = 18
const INITIAL_CELL_WIDTH = 7.8
const KEYS: TerminalKey[] = ['Escape', 'Tab', 'Enter', 'Backspace', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'Delete', 'PageUp', 'PageDown']
const MONOSPACE = Platform.OS === 'ios' ? 'Menlo' : 'monospace'

export interface TerminalSurfaceProps {
    channel: TerminalChannel
    active: boolean
    onFailure: (message: string) => void
}

/** A fixed cell viewport: output never shares a native host with the keyboard composer. */
export function TerminalSurface({ channel, active, onFailure }: TerminalSurfaceProps) {
    const theme = useAppTheme()
    const [foreground, setForeground] = useState(AppState.currentState === 'active')
    const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null)
    const [draft, setDraft] = useState('')
    const [inputRevision, setInputRevision] = useState(0)
    const inputFence = useRef(new TerminalInputFence())
    const [hidden, setHidden] = useState(true)
    const [blink, setBlink] = useState(true)
    const [cellWidth, setCellWidth] = useState(INITIAL_CELL_WIDTH)
    const [bounds, setBounds] = useState({ width: 0, height: 360 })
    const engine = useRef<TerminalEngine | null>(null)
    const failure = useRef(onFailure)
    failure.current = onFailure
    const visible = active && foreground
    const context = `${channel.id}:${snapshot?.generation ?? -1}`
    const host = `${context}:${inputRevision}`
    const current = useRef({ visible, context, host, draft, channel })
    current.current = { visible, context, host, draft, channel }

    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => {
            if (state !== 'active') {
                // Invalidate synchronously, before a queued native input event or React commit.
                current.current.visible = false
                engine.current?.dispose(); engine.current = null
                setDraft(''); setSnapshot(null)
            }
            setForeground(state === 'active')
        })
        return () => subscription.remove()
    }, [])

    useEffect(() => {
        setDraft(''); setSnapshot(null)
        if (!visible) return
        let owned: TerminalEngine | null = null
        let firstSnapshot: TerminalSnapshot | null = null
        let failed = false
        try {
            owned = new TerminalEngine(channel, next => {
                firstSnapshot = next
                if (engine.current === owned && current.current.visible && current.current.channel === channel) setSnapshot(next)
            }, message => {
                failed = true
                if (current.current.channel === channel && current.current.visible) {
                    engine.current = null; setDraft(''); setSnapshot(null)
                    failure.current(message)
                }
            })
            if (!failed) { engine.current = owned; setSnapshot(firstSnapshot ?? owned.snapshot()) }
        } catch {
            owned?.dispose()
            failure.current('This device could not start the terminal. Close this console and try again.')
        }
        return () => {
            owned?.dispose()
            if (engine.current === owned) engine.current = null
        }
    }, [channel, visible])

    useEffect(() => { setDraft(''); setHidden(true) }, [context, visible])
    useEffect(() => {
        if (!visible) return
        const timer = setInterval(() => setBlink(value => !value), 500)
        return () => clearInterval(timer)
    }, [visible])
    useEffect(() => {
        if (visible && bounds.width > 0) engine.current?.resize(Math.floor(bounds.width / cellWidth), Math.floor(bounds.height / LINE_HEIGHT))
    }, [bounds, cellWidth, visible, channel])

    const owned = () => {
        const live = current.current
        const instance = engine.current
        return live.visible && live.context === context && live.channel === channel && snapshot && instance?.matches(channel) && instance.owns(snapshot.generation) ? instance : null
    }
    const renewInput = (clearDraft = true) => {
        current.current.host = 'retired'
        if (clearDraft) { current.current.draft = ''; setDraft('') }
        setInputRevision(inputFence.current.retire())
    }
    const editable = () => inputFence.current.permits(inputRevision, current.current.host === host) ? owned() : null
    const sendDraft = (paste: boolean) => {
        const instance = editable()
        if (!instance || !current.current.draft) return
        const text = current.current.draft
        const accepted = paste ? instance.paste(text, snapshot!.generation) : instance.send(`${text}\r`, snapshot!.generation)
        if (accepted && current.current.context === context && current.current.draft === text) {
            renewInput()
        }
    }
    const pointer = (event: GestureResponderEvent, action: 'press' | 'release' | 'move') => {
        const instance = owned()
        if (!instance || !snapshot?.mouse) return
        instance.mouse(Math.floor(event.nativeEvent.locationX / cellWidth), Math.floor(event.nativeEvent.locationY / LINE_HEIGHT), action, snapshot.generation)
    }
    const frame = visible && engine.current?.matches(channel) ? snapshot?.frame : null

    return (
        <View style={styles.container}>
            <Text style={{ color: theme.textMuted }}>{snapshot?.state === 'ready' ? 'Connected' : snapshot?.state === 'closed' ? 'Closed' : 'Connecting'}{snapshot?.message ? ` · ${snapshot.message}` : ''}</Text>
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>Unicode 6 terminal widths. Some emoji and complex scripts may not align. {snapshot?.mouse ? 'Mouse reporting is enabled: touches are sent to the remote program.' : 'Use History controls to scroll retained output.'}</Text>
            <Text
                pointerEvents='none'
                allowFontScaling={false}
                style={styles.measure}
                onLayout={event => {
                    const width = event.nativeEvent.layout.width / 10
                    if (width > 3 && width < 30) setCellWidth(width)
                }}
            >MMMMMMMMMM</Text>
            <View
                key={`viewport:${context}`}
                accessibilityLabel='Terminal output'
                style={styles.viewport}
                onLayout={event => setBounds({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
                onStartShouldSetResponder={() => !!owned() && !!snapshot?.mouse}
                onMoveShouldSetResponder={() => !!owned() && !!snapshot?.mouse}
                onResponderGrant={event => pointer(event, 'press')}
                onResponderMove={event => pointer(event, 'move')}
                onResponderRelease={event => pointer(event, 'release')}
                onResponderTerminate={event => pointer(event, 'release')}
            >
                {frame?.lines.map((cells, row) => (
                    <View key={row} style={{ position: 'absolute', top: row * LINE_HEIGHT, left: 0, width: frame.cols * cellWidth, height: LINE_HEIGHT }}>
                        {cells.map(cell => <Cell key={cell.column} cell={cell} width={cellWidth} blink={blink} />)}
                    </View>
                ))}
                {frame && snapshot?.cursorVisible && (!snapshot.cursorBlink || blink) && snapshot.state === 'ready' && frame.cursorY >= 0 && frame.cursorY < frame.rows && <View pointerEvents='none' style={[
                    styles.cursor,
                    { left: frame.cursorX * cellWidth, top: frame.cursorY * LINE_HEIGHT, width: snapshot.cursorStyle === 'bar' ? 2 : cellWidth, height: snapshot.cursorStyle === 'underline' ? 2 : LINE_HEIGHT },
                    snapshot.cursorStyle === 'underline' && { transform: [{ translateY: LINE_HEIGHT - 2 }] },
                ]} />}
            </View>
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>{frame ? `${frame.cols} × ${frame.rows} · ${frame.alternate ? 'Alternate screen' : `History ${frame.viewport}/${frame.bottom}`}` : 'No terminal output retained'}</Text>
            <View key={context} style={styles.controls}>
                {KEYS.map(key => <PillButton key={key} label={key} small disabled={!owned()} onPress={() => owned()?.key(key, snapshot!.generation)} />)}
                {['C', 'D', 'Z', 'L', 'A', 'E', 'U', 'W'].map(letter => <PillButton key={letter} label={`Ctrl-${letter}`} small disabled={!owned()} onPress={() => owned()?.control(letter, snapshot!.generation)} />)}
                <PillButton label='History up' small disabled={!owned()} onPress={() => owned()?.scroll(-6, snapshot!.generation)} />
                <PillButton label='History down' small disabled={!owned()} onPress={() => owned()?.scroll(6, snapshot!.generation)} />
            </View>
            <View key={`composer:${host}:${visible}`} style={styles.composer}>
                <TextInput
                    accessibilityLabel='Terminal input'
                    value={owned() ? draft : ''}
                    secureTextEntry={hidden}
                    editable={!!owned()}
                    autoCapitalize='none'
                    autoCorrect={false}
                    spellCheck={false}
                    maxLength={16000}
                    placeholder='Type a command or paste text'
                    placeholderTextColor={theme.textMuted}
                    style={[styles.input, { color: theme.text, borderColor: theme.surfaceBorder }]}
                    onChangeText={text => {
                        if (editable()) { current.current.draft = text; setDraft(text) }
                    }}
                    onSubmitEditing={() => sendDraft(false)}
                    blurOnSubmit={false}
                />
                <View style={styles.controls}>
                    <PillButton label='Send + Enter' disabled={!owned() || !draft} onPress={() => sendDraft(false)} />
                    <PillButton label='Send Ctrl' disabled={!owned() || draft.length !== 1} onPress={() => {
                        const instance = editable()
                        if (instance?.control(current.current.draft, snapshot!.generation)) renewInput()
                    }} />
                    <PillButton label='Paste text' disabled={!owned() || !draft} onPress={() => sendDraft(true)} />
                    <Pressable accessibilityRole='button' onPress={() => { if (editable()) { renewInput(false); setHidden(value => !value) } }}><Text style={{ color: theme.textMuted }}>{hidden ? 'Show input' : 'Hide input'}</Text></Pressable>
                    <PillButton label='Clear input' disabled={!owned() || !draft} onPress={() => { if (editable()) renewInput() }} />
                </View>
            </View>
        </View>
    )
}

function Cell({ cell, width, blink }: { cell: TerminalCell; width: number; blink: boolean }) {
    return (
        <View pointerEvents='none' style={{ position: 'absolute', left: cell.column * width, width: cell.width * width, height: LINE_HEIGHT, backgroundColor: cell.background, overflow: 'hidden' }}>
            <Text allowFontScaling={false} style={{ fontFamily: MONOSPACE, fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, includeFontPadding: false,
                color: cell.foreground, opacity: cell.blink && !blink ? 0 : cell.dim ? 0.5 : 1, fontWeight: cell.bold ? 'bold' : 'normal', fontStyle: cell.italic ? 'italic' : 'normal',
                textDecorationLine: cell.underline && cell.strike ? 'underline line-through' : cell.underline ? 'underline' : cell.strike ? 'line-through' : 'none' }}>
                {cell.text}
            </Text>
            {cell.overline && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: cell.foreground }} />}
        </View>
    )
}

const styles = StyleSheet.create({
    container: { gap: 10 },
    viewport: { height: 360, width: '100%', backgroundColor: CELL_BACKGROUND, overflow: 'hidden' },
    measure: { position: 'absolute', opacity: 0, fontFamily: MONOSPACE, fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, alignSelf: 'flex-start' },
    cursor: { position: 'absolute', borderWidth: 1, borderColor: '#e5e5e5', backgroundColor: '#e5e5e533' },
    controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
    composer: { gap: 8 },
    input: { borderWidth: 1, borderRadius: 8, padding: 12, fontFamily: MONOSPACE, fontSize: FONT_SIZE, minHeight: 44 },
})
