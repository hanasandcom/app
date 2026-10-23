import type { AppSettings } from '../../types'
import type { ContentKind, Mutation } from './contracts'
import { PublishingError } from './contracts'

export type PendingPublication = { key: string; action: Mutation['action']; id: string | null; digest: string; length: number; creatorId: string; nonce: number }
export type PublishingDigest = (text: string) => Promise<string>
export const nativeDigest: PublishingDigest = async text => {
    const crypto = await import('expo-crypto')
    return crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, text)
}
// Non-secret intent metadata only, process memory only. Unresolved entries are never evicted.
const unresolved = new Map<string, PendingPublication>()
let nonce = 0
export function publicationKey(settings: AppSettings, kind: ContentKind) {
    return JSON.stringify([settings.apiBaseUrl.replace(/\/+$/, ''), settings.userId, settings.selectedOrganizationId || null, kind])
}
export const pendingPublication = (key: string) => unresolved.get(key)
export function rememberPublication(key: string, mutation: Mutation, digest: string, creatorId: string, id: string | null) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new PublishingError('The submission fingerprint could not be verified.')
    if (unresolved.has(key)) throw new PublishingError('Review the earlier uncertain publishing operation first.')
    if (unresolved.size >= 100) throw new PublishingError('Too many unresolved publishing operations. Review an earlier operation first.')
    const intent = { key, action: mutation.action, id, digest, length: mutation.draft.body.length, creatorId, nonce: ++nonce }
    unresolved.set(key, intent)
    return intent
}
export function forgetPublication(intent: PendingPublication) {
    if (unresolved.get(intent.key)?.nonce === intent.nonce) unresolved.delete(intent.key)
}
