// Ported from Hanasand api/src/utils/pwned/compactRange.ts. Keep the wire format and validation aligned.
import { Unzlib } from 'fflate'

export type BreachFile = { file: string; count: number; lineRanges: [number, number][] }
const MAX_BLOCK = 64 * 1024 * 1024
const MAX_BUNDLE = 32 * 1024 * 1024
const invalid = () => new Error('The password index returned an invalid response.')

// Shared exact-match decoder for browser lookups and password validation.
export async function parseCompactRange(buffer: ArrayBuffer, hash: string): Promise<{ count: number; files: BreachFile[] }> {
    if (!/^[A-F0-9]{40}$/i.test(hash)) throw invalid()
    const view = new DataView(buffer)
    const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength)))
    if (magic !== 'PWNPRF02') return parseSingleRange(buffer, hash, new Set())
    if (buffer.byteLength < 16 || buffer.byteLength > MAX_BUNDLE || view.getUint32(12, true) !== parseInt(hash.slice(0, 5), 16)) throw invalid()
    const frames = view.getUint32(8, true)
    if (frames < 2 || frames > 16) throw invalid()
    const parts: ArrayBuffer[] = []
    let position = 16
    let expanded = 0
    for (let frame = 0; frame < frames; frame++) {
        if (position + 4 > buffer.byteLength) throw invalid()
        const length = view.getUint32(position, true)
        position += 4
        if (length < 16 || position + length > buffer.byteLength) throw invalid()
        const catalogLength = view.getUint32(position + 8, true)
        const blockStart = position + 16 + catalogLength
        if (blockStart > position + length) throw invalid()
        if (blockStart < position + length) {
            if (position + length - blockStart < 5) throw invalid()
            expanded += view.getUint32(blockStart, true)
            if (expanded > MAX_BLOCK) throw invalid()
        }
        parts.push(buffer.slice(position, position + length))
        position += length
    }
    if (position !== buffer.byteLength) throw invalid()
    const result: { count: number; files: BreachFile[] } = { count: 0, files: [] }
    const seenFiles = new Set<string>()
    for (const part of parts) {
        const match = await parseSingleRange(part, hash, seenFiles)
        result.count += match.count
        if (!Number.isSafeInteger(result.count)) throw invalid()
        result.files.push(...match.files)
    }
    return result
}

async function parseSingleRange(buffer: ArrayBuffer, hash: string, seenFiles: Set<string>): Promise<{ count: number; files: BreachFile[] }> {
    if (buffer.byteLength > MAX_BLOCK + 65552) throw invalid()
    const bytes = new Uint8Array(buffer)
    const view = new DataView(buffer)
    if (bytes.length < 16 || new TextDecoder().decode(bytes.subarray(0, 8)) !== 'PWNPRF01') throw invalid()
    const catalogLength = view.getUint32(8, true)
    if (view.getUint32(12, true) !== parseInt(hash.slice(0, 5), 16) || catalogLength > MAX_BLOCK || 16 + catalogLength > bytes.length) throw invalid()
    const catalog: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(16, 16 + catalogLength)))
    if (!Array.isArray(catalog) || !catalog.every(file => typeof file === 'string')) throw invalid()
    for (const file of catalog) {
        if (seenFiles.has(file)) throw invalid()
        seenFiles.add(file)
    }
    const blockStart = 16 + catalogLength
    if (blockStart === bytes.length) return { count: 0, files: [] }
    if (bytes.length - blockStart < 5 || bytes.length - blockStart > MAX_BLOCK + 65536) throw invalid()
    const expected = view.getUint32(blockStart, true)
    if (expected < 8 || expected > MAX_BLOCK) throw invalid()
    const raw = new Uint8Array(expected)
    let written = 0
    let completed = false
    let checksumA = 1
    let checksumB = 0
    const inflater = new Unzlib((chunk, final) => {
        if (written + chunk.length > expected) throw invalid()
        raw.set(chunk, written)
        written += chunk.length
        // Unzlib does not verify the zlib checksum; preserve the browser decoder's check.
        for (let offset = 0; offset < chunk.length; offset += 5552) {
            for (let index = offset; index < Math.min(offset + 5552, chunk.length); index++) { checksumA += chunk[index]; checksumB += checksumA }
            checksumA %= 65521; checksumB %= 65521
        }
        completed = final
    })
    // Bound each synchronous inflate step, including malformed expansion claims.
    const compressed = bytes.subarray(blockStart + 4)
    try {
        for (let position = 0; position < compressed.length; position += 1024) {
            inflater.push(compressed.subarray(position, position + 1024), position + 1024 >= compressed.length)
        }
    } catch { throw invalid() }
    if (!completed) throw invalid()
    if (written !== expected || compressed.length < 6 || ((checksumB << 16 | checksumA) >>> 0) !== new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength).getUint32(compressed.length - 4)) throw invalid()
    const data = new DataView(raw.buffer)
    const entries = data.getUint32(0, true)
    const offsets = 4 + entries * 18
    const postings = offsets + (entries + 1) * 4
    if (postings > raw.length) throw invalid()
    const suffix = Uint8Array.from(hash.slice(4).match(/../g)!, hex => parseInt(hex, 16))
    const compare = (position: number) => {
        for (let byte = 0; byte < 18; byte++) {
            const difference = raw[4 + position * 18 + byte] - suffix[byte]
            if (difference) return difference
        }
        return 0
    }
    let low = 0
    let high = entries
    while (low < high) {
        const mid = Math.floor((low + high) / 2)
        if (compare(mid) < 0) low = mid + 1
        else high = mid
    }
    if (low === entries || compare(low)) return { count: 0, files: [] }
    let position = postings + data.getUint32(offsets + low * 4, true)
    const end = postings + data.getUint32(offsets + (low + 1) * 4, true)
    if (position < postings || position >= end || end > raw.length) throw invalid()
    const integer = () => {
        let result = 0
        for (let shift = 0; shift < 56; shift += 7) {
            if (position >= end) throw invalid()
            const byte = raw[position++]
            result += (byte & 127) * 2 ** shift
            if (!Number.isSafeInteger(result)) throw invalid()
            if (byte < 128) return result
        }
        throw invalid()
    }
    const groups = integer()
    if (!groups || groups > catalog.length) throw invalid()
    let fileId = 0
    let total = 0
    const files: BreachFile[] = []
    for (let group = 0; group < groups; group++) {
        const delta = integer()
        if (group && !delta) throw invalid()
        fileId += delta
        if (fileId >= catalog.length) throw invalid()
        const runs = integer()
        if (!runs || runs > (end - position) / 2) throw invalid()
        let line = 0
        let count = 0
        const lineRanges: [number, number][] = []
        for (let run = 0; run < runs; run++) {
            const step = integer()
            const length = integer()
            if (!step || !length) throw invalid()
            const start = line + step
            line = start + length - 1
            count += length
            if (!Number.isSafeInteger(line) || !Number.isSafeInteger(count)) throw invalid()
            lineRanges.push([start, line])
        }
        total += count
        if (!Number.isSafeInteger(total)) throw invalid()
        files.push({ file: catalog[fileId], count, lineRanges })
    }
    if (position !== end) throw invalid()
    return { count: total, files }
}
