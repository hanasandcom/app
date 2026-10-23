import { document, type ThesisDocument } from './document'

export type RecoveredDraft = { version: 1; scope: string; sequence: number; savedAt: number; draft: ThesisDocument | null; uncertain: boolean }
export type RecoveryAdapter = {
    read: (slot: number) => Promise<string | null>
    write: (slot: number, sealed: string) => Promise<void>
    seal: (bytes: Uint8Array, aad: Uint8Array) => Promise<string>
    open: (sealed: string, aad: Uint8Array) => Promise<Uint8Array>
}
const limit = 8_100_000
const encoder = new TextEncoder()
const queues = new Map<string, Promise<unknown>>()

function parse(value: unknown, scope: string): RecoveredDraft {
    const v = value as RecoveredDraft
    if (!v || v.version !== 1 || v.scope !== scope || !Number.isSafeInteger(v.sequence) || v.sequence < 0
        || typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt) || typeof v.uncertain !== 'boolean') throw new Error('Invalid recovery snapshot.')
    return { ...v, draft: v.draft === null ? null : document(v.draft) }
}

export function createRecovery(scope: string, adapter: RecoveryAdapter) {
    const aad = encoder.encode('hanasand-thesis-recovery.v1\n' + scope)
    async function latest() {
        const candidates = await Promise.all([0, 1].map(async slot => {
            const sealed = await adapter.read(slot)
            if (!sealed) return null
            if (sealed.length > limit || !/^[A-Za-z0-9+/]*={0,2}$/.test(sealed)) throw new Error('The encrypted recovery snapshot is invalid.')
            const bytes = await adapter.open(sealed, aad)
            if (bytes.length > 6_000_000) throw new Error('The recovery snapshot exceeded its limit.')
            return parse(JSON.parse(new TextDecoder().decode(bytes)), scope)
        }).map(p => p.catch(() => null)))
        return candidates.filter((v): v is RecoveredDraft => v !== null).sort((a, b) => b.sequence - a.sequence)[0] ?? null
    }
    return {
        async load() { await queues.get(scope)?.catch(() => {}); return latest() },
        save(draft: ThesisDocument | null, uncertain = false) {
            const captured = draft ? document(draft) : null
            const previous = queues.get(scope) ?? Promise.resolve()
            const next = previous.catch(() => {}).then(async () => {
                const old = await latest()
                const value: RecoveredDraft = { version: 1, scope, sequence: (old?.sequence ?? 0) + 1, savedAt: Date.now(), draft: captured, uncertain }
                const bytes = encoder.encode(JSON.stringify(value))
                if (bytes.length > 6_000_000) throw new Error('The recovery snapshot exceeded its limit.')
                const sealed = await adapter.seal(bytes, aad)
                if (sealed.length > limit) throw new Error('The encrypted recovery snapshot exceeded its limit.')
                await adapter.write(value.sequence % 2, sealed)
            })
            queues.set(scope, next)
            void next.finally(() => { if (queues.get(scope) === next) queues.delete(scope) }).catch(() => {})
            return next
        },
    }
}
export type ThesisRecovery = ReturnType<typeof createRecovery>

const keys = new Map<string, Promise<import('expo-crypto').AESEncryptionKey>>()
export async function nativeRecovery(userId: string, apiBaseUrl: string, siteBaseUrl: string) {
    const Crypto = await import('expo-crypto')
    const SecureStore = await import('expo-secure-store')
    const { File, Directory, Paths } = await import('expo-file-system')
    const scope = JSON.stringify({ userId, api: new URL(apiBaseUrl).toString(), site: new URL(siteBaseUrl).toString() })
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scope)
    const name = 'hanasand.thesis-recovery.' + hash
    let pending = keys.get(name)
    if (!pending) {
        pending = (async () => {
            const stored = await SecureStore.getItemAsync(name)
            if (stored) {
                if (!/^[A-Za-z0-9+/]{43}=$/.test(stored)) throw new Error('The local draft encryption key is invalid.')
                return Crypto.AESEncryptionKey.import(stored, 'base64')
            }
            const key = await Crypto.AESEncryptionKey.generate()
            await SecureStore.setItemAsync(name, await key.encoded('base64'), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
            return key
        })()
        keys.set(name, pending)
        void pending.finally(() => { if (keys.get(name) === pending) keys.delete(name) }).catch(() => {})
    }
    const key = await pending
    const directory = new Directory(Paths.document, 'thesis-recovery')
    directory.create({ idempotent: true, intermediates: true })
    const file = (slot: number) => new File(directory, hash + '.' + slot + '.sealed')
    return createRecovery(scope, {
        async read(slot) {
            const target = file(slot)
            if (!target.exists) return null
            if (target.size > limit) throw new Error('The encrypted draft file exceeded its limit.')
            return target.text()
        },
        async write(slot, sealed) { file(slot).write(sealed) },
        async seal(bytes, additionalData) { return (await Crypto.aesEncryptAsync(bytes, key, { additionalData, nonce: { length: 12 }, tagLength: 16 })).combined('base64') },
        async open(sealed, additionalData) { return Crypto.aesDecryptAsync(Crypto.AESSealedData.fromCombined(sealed, { ivLength: 12, tagLength: 16 }), key, { additionalData }) },
    })
}
