import { utf8Size, type PrivacyExport } from './model'
import { verifyExportChecksum } from './api'

export type PrivacyFileAdapter = {
    write: (filename: string, content: string) => Promise<{ uri: string; remove: () => void }>
    share: (uri: string, isCurrent: () => boolean) => Promise<void>
}
let exportSequence = 0
export async function sharePrivacyExport(exported: PrivacyExport, isCurrent: () => boolean, adapter?: PrivacyFileAdapter) {
    if (!isCurrent()) return
    await verifyExportChecksum(exported)
    if (!isCurrent()) return
    const content = JSON.stringify(exported, null, 2)
    if (content.length > 24 * 1024 * 1024 || utf8Size(content) > 24 * 1024 * 1024) throw new Error('This export is too large to share on this device.')
    const filename = `organization-privacy-${Date.now()}-${++exportSequence}.json`
    const files = adapter || await nativeFiles()
    if (!isCurrent()) return
    const file = await files.write(filename, content)
    try { if (isCurrent()) await files.share(file.uri, isCurrent) } finally { file.remove() }
}
export async function guardedPrivacyShare(uri: string, isCurrent: () => boolean, available: () => Promise<boolean>, share: (uri: string) => Promise<unknown>) {
    if (!isCurrent()) return
    if (!await available()) throw new Error('File sharing is unavailable on this device.')
    if (!isCurrent()) return
    await share(uri)
}
async function nativeFiles(): Promise<PrivacyFileAdapter> {
    const { File, Paths } = await import('expo-file-system')
    const Sharing = await import('expo-sharing')
    return {
        write: async (name, content) => {
            const file = new File(Paths.cache, name)
            try { file.write(content) } catch (cause) { if (file.exists) file.delete(); throw cause }
            return { uri: file.uri, remove: () => { if (file.exists) file.delete() } }
        },
        share: (uri, isCurrent) => guardedPrivacyShare(uri, isCurrent, Sharing.isAvailableAsync,
            value => Sharing.shareAsync(value, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Organization privacy export' })),
    }
}
