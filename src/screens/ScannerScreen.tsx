import { useMemo, useRef, useState } from 'react'
import { Alert, Image, ScrollView, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as FileSystem from 'expo-file-system/legacy'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import type { ScannerPage } from '../types'
import { GlassCard, PillButton, Screen, SectionTitle } from '../components/ui'
import { spacing } from '../theme/tokens'
import { useAppTheme } from '../theme/context'

export function ScannerScreen() {
    const theme = useAppTheme()
    const [permission, requestPermission] = useCameraPermissions()
    const cameraRef = useRef<CameraView | null>(null)
    const [pages, setPages] = useState<ScannerPage[]>([])
    const [busy, setBusy] = useState(false)
    const [showCamera, setShowCamera] = useState(false)
    const [lastPdfUri, setLastPdfUri] = useState('')

    const orderedPages = useMemo(() => pages, [pages])

    async function capture() {
        if (!cameraRef.current) {
            Alert.alert('Camera unavailable', 'Open the camera before capturing a page.')
            return
        }
        setBusy(true)
        try {
            const shot = await cameraRef.current.takePictureAsync({ quality: 0.85 })
            if (!shot?.uri) {
                Alert.alert('Capture failed', 'The camera did not return an image.')
                return
            }
            setPages(current => [...current, { id: `${Date.now()}-${current.length}`, uri: shot.uri, createdAt: Date.now() }])
        } catch (cause) {
            Alert.alert('Capture failed', cause instanceof Error ? cause.message : 'The camera could not save this page.')
        } finally {
            setBusy(false)
        }
    }

    function move(index: number, direction: -1 | 1) {
        setPages(current => {
            const next = [...current]
            const target = index + direction
            if (target < 0 || target >= next.length) return current
            const [page] = next.splice(index, 1)
            next.splice(target, 0, page)
            return next
        })
    }

    function remove(index: number) {
        const page = pages[index]
        if (!page) return
        Alert.alert('Delete page?', `Page ${index + 1} will be removed from this scan.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => setPages(current => current.filter((_, itemIndex) => itemIndex !== index)) },
        ])
    }

    function clearPages() {
        if (!pages.length) return
        Alert.alert('Clear scanned pages?', `${pages.length} pages will be removed from this scan.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Clear', style: 'destructive', onPress: () => setPages([]) },
        ])
    }

    async function sharePdf(uri = lastPdfUri) {
        if (!uri) return
        try {
            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Export scanned PDF' })
            } else {
                Alert.alert('PDF ready', uri)
            }
        } catch (cause) {
            Alert.alert('Share failed', cause instanceof Error ? cause.message : 'Unable to share the PDF.')
        }
    }

    async function exportPdf() {
        if (!pages.length) {
            Alert.alert('No pages', 'Capture at least one page before exporting.')
            return
        }
        setBusy(true)
        try {
            const encoded = await Promise.all(
                pages.map(async page => {
                    const base64 = await FileSystem.readAsStringAsync(page.uri, { encoding: FileSystem.EncodingType.Base64 })
                    return `data:image/jpeg;base64,${base64}`
                }),
            )
            const html = `
        <html>
          <body style="margin:0;padding:24px;background:#101820;">
            ${encoded.map(src => `<div style="page-break-after:always;margin-bottom:24px;"><img src="${src}" style="width:100%;border-radius:16px;object-fit:contain;" /></div>`).join('')}
          </body>
        </html>
      `
            const file = await Print.printToFileAsync({ html })
            setLastPdfUri(file.uri)
            await sharePdf(file.uri)
        } catch (cause) {
            Alert.alert('PDF export failed', cause instanceof Error ? cause.message : 'Unable to export the scan bundle.')
        } finally {
            setBusy(false)
        }
    }

    if (!permission) {
        return <Screen title='Scanner' subtitle=''><GlassCard><Text style={{ color: theme.text }}>Checking camera access...</Text></GlassCard></Screen>
    }

    if (!permission.granted) {
        return (
            <Screen title='Scanner' subtitle=''>
                <GlassCard>
                    <SectionTitle eyebrow='Permission required' title='Camera access needed' />
                    <View style={{ marginTop: spacing.md }}>
                        <PillButton label='Allow camera access' onPress={() => void requestPermission()} tone='accent' />
                    </View>
                </GlassCard>
            </Screen>
        )
    }

    return (
        <Screen title='Scanner' subtitle='' scroll={false}>
            <View style={{ flex: 1, gap: spacing.md }}>
                <GlassCard>
                    <SectionTitle eyebrow='Capture' title={showCamera ? 'Camera ready' : 'Batch scan'} />
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                        <PillButton label={showCamera ? 'Hide camera' : 'Open camera'} onPress={() => setShowCamera(current => !current)} tone='accent' />
                        <PillButton label={busy ? 'Working...' : 'Export PDF'} onPress={() => void exportPdf()} disabled={busy || !pages.length} />
                        {!!pages.length && <PillButton label='Clear pages' onPress={clearPages} tone='danger' disabled={busy} />}
                    </View>
                </GlassCard>

                {showCamera && (
                    <GlassCard style={{ padding: 10 }}>
                        <CameraView ref={cameraRef} facing='back' autofocus='on' style={{ height: 280, borderRadius: 22, overflow: 'hidden' }} />
                        <View style={{ marginTop: spacing.sm }}>
                            <PillButton label={busy ? 'Capturing...' : 'Capture page'} onPress={() => void capture()} tone='accent' disabled={busy} />
                        </View>
                    </GlassCard>
                )}

                <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: 180 }}>
                    <GlassCard>
                        <SectionTitle eyebrow='Pages' title={`${orderedPages.length} pages`} />
                    </GlassCard>
                    {!!lastPdfUri && (
                        <GlassCard>
                            <SectionTitle eyebrow='Last export' title='PDF ready' body={lastPdfUri.split('/').pop() || lastPdfUri} />
                            <View style={{ marginTop: spacing.md }}>
                                <PillButton label='Share again' onPress={() => void sharePdf()} tone='accent' disabled={busy} />
                            </View>
                        </GlassCard>
                    )}
                    {orderedPages.map((page, index) => (
                        <GlassCard key={page.id}>
                            <Image source={{ uri: page.uri }} style={{ width: '100%', height: 240, borderRadius: 22, backgroundColor: theme.ambientNeutral }} resizeMode='cover' />
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md }}>
                                <Text style={{ color: theme.text, fontWeight: '700' }}>Page {index + 1}</Text>
                                <Text style={{ color: theme.textSoft }}>Ready for PDF</Text>
                            </View>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                                {index > 0 && <PillButton label='Move up' onPress={() => move(index, -1)} small />}
                                {index < orderedPages.length - 1 && <PillButton label='Move down' onPress={() => move(index, 1)} small />}
                                <PillButton label='Delete page' onPress={() => remove(index)} tone='danger' small />
                            </View>
                        </GlassCard>
                    ))}
                </ScrollView>
            </View>
        </Screen>
    )
}
