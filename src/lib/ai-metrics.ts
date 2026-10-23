import type { AppSettings } from '../types'
import { apiFetch, fetchAiModels } from './api'

export const aiMetricsLimit = 2 * 1024 * 1024
export type NullableNumber = number | null
export type AiSensor = { name: string; load: NullableNumber; memoryUsedMb: NullableNumber; memoryTotalMb: NullableNumber; powerDrawWatts: NullableNumber; temperatureC: NullableNumber }
export type AiLane = { id: string; label: string; model: string; tier: string; gpuName: string; active: NullableNumber; available: NullableNumber; maximum: NullableNumber; queued: NullableNumber; context: NullableNumber; memoryUsedMb: NullableNumber; memoryTotalMb: NullableNumber; watts: NullableNumber; temperatureC: NullableNumber }
export type AiMetricsClient = {
    name: string; displayName: string; modelId: string; profile: string
    ram: AiSensor[] | null; cpu: AiSensor[] | null; gpu: AiSensor[] | null; lanes: AiLane[] | null
    watts: NullableNumber; monthlyKwh: NullableNumber; sampledAt: string
    model: { status: string; currentTokens: NullableNumber; maximumTokens: NullableNumber; promptTokens: NullableNumber; generatedTokens: NullableNumber; contextTokens: NullableNumber; contextMaximum: NullableNumber; tps: NullableNumber; lastUpdated: string; lastError: string }
}
export type AiQueueRow = { lane: string; model: string; kind: string; status: string; count: NullableNumber }
export type AiMetricsEconomics = { windowDays: NullableNumber; firstOutputP50: NullableNumber; firstOutputP95: NullableNumber; sampleCount: NullableNumber; queue: AiQueueRow[] }
export type AiContainer = { id: string; name: string; image: string; status: string; health: string }
export type AiContainers = { items: AiContainer[]; generatedAt: string; unavailable: string }
export class AiMetricsError extends Error {
    constructor(message: string, readonly status = 0) { super(message) }
}
export const aiMetricsScope = (settings: AppSettings) => JSON.stringify([settings.apiBaseUrl, settings.siteBaseUrl, settings.userId, settings.authToken, settings.impersonationToken, settings.impersonatingUserId, settings.selectedOrganizationId])
export const aiRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export const aiNumber = (value: unknown): NullableNumber => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
export const aiText = (value: unknown, length = 300) => typeof value === 'string' ? value.slice(0, length) : ''
export function aiMetricsEndpoint(base: string, path: string) {
    const parsed = new URL(base)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new AiMetricsError('Use a secure API address without credentials or query parameters.')
    return `${base.replace(/\/+$/, '')}/${path}`
}
export function aiUtf8Bytes(value: string) {
    let bytes = 0
    for (const character of value) { const point = character.codePointAt(0)!; bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4 }
    return bytes
}
function sensors(value: unknown): AiSensor[] | null {
    if (!Array.isArray(value)) return null
    if (value.length > 512) throw new AiMetricsError('Too many sensor rows. Refresh to try again.')
    return value.map(item => {
        const row = aiRecord(item), load = aiNumber(row.load)
        return { name: aiText(row.name), load: load !== null && load <= 1 ? load : null, memoryUsedMb: aiNumber(row.memoryUsedMb), memoryTotalMb: aiNumber(row.memoryTotalMb), powerDrawWatts: aiNumber(row.powerDrawWatts), temperatureC: aiNumber(row.temperatureC) }
    })
}
export function parseAiClient(value: unknown): AiMetricsClient {
    const row = aiRecord(value), model = aiRecord(row.model), power = aiRecord(row.power)
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 300 || Array.isArray(row.lanes) && row.lanes.length > 512) throw new AiMetricsError('Invalid AI client telemetry. Refresh to try again.')
    return {
        name: aiText(row.name), displayName: aiText(row.displayName), modelId: aiText(row.modelId), profile: aiText(row.profile),
        ram: sensors(row.ram), cpu: sensors(row.cpu), gpu: sensors(row.gpu),
        lanes: Array.isArray(row.lanes) ? row.lanes.map((item, index) => {
            const lane = aiRecord(item)
            return { id: aiText(lane.id) || String(index), label: aiText(lane.label) || `Lane ${index + 1}`, model: aiText(lane.model), tier: aiText(lane.tier), gpuName: aiText(lane.gpuName), active: aiNumber(lane.activeRequests), available: aiNumber(lane.availableRequests), maximum: aiNumber(lane.maxRequests), queued: aiNumber(lane.queuedRequests), context: aiNumber(lane.contextMaxTokens), memoryUsedMb: aiNumber(lane.memoryUsedMb), memoryTotalMb: aiNumber(lane.memoryTotalMb), watts: aiNumber(lane.powerDrawWatts), temperatureC: aiNumber(lane.temperatureC) }
        }) : null,
        watts: aiNumber(power.totalWatts), monthlyKwh: aiNumber(power.monthlyKwh), sampledAt: aiText(power.sampledAt),
        model: { status: aiText(model.status), currentTokens: aiNumber(model.currentTokens), maximumTokens: aiNumber(model.maxTokens), promptTokens: aiNumber(model.promptTokens), generatedTokens: aiNumber(model.generatedTokens), contextTokens: aiNumber(model.contextTokens), contextMaximum: aiNumber(model.contextMaxTokens), tps: aiNumber(model.tps), lastUpdated: aiText(model.lastUpdated), lastError: aiText(model.lastError, 1000) },
    }
}
export function parseAiEconomics(value: unknown): AiMetricsEconomics {
    const row = aiRecord(value), reliability = aiRecord(row.reliability), timing = aiRecord(reliability.promptTiming)
    if (!Array.isArray(reliability.queueDepth) || reliability.queueDepth.length > 10000) throw new AiMetricsError('Queue telemetry is unavailable. Refresh to try again.')
    return { windowDays: aiNumber(row.windowDays), firstOutputP50: aiNumber(timing.p50FirstUsefulOutputMs), firstOutputP95: aiNumber(timing.p95FirstUsefulOutputMs), sampleCount: aiNumber(timing.sampleCount), queue: reliability.queueDepth.map(item => {
        const data = aiRecord(item)
        return { lane: aiText(data.lane), model: aiText(data.model), kind: aiText(data.kind), status: aiText(data.status), count: aiNumber(data.count) }
    }) }
}
export function parseAiContainers(value: unknown): AiContainers {
    const outer = aiRecord(value), nested = aiRecord(outer.data), row = Object.keys(nested).length ? nested : outer
    const list = Array.isArray(value) ? value : Array.isArray(row.containers) ? row.containers : Array.isArray(outer.data) ? outer.data : null
    if (!list || list.length > 10000) throw new AiMetricsError('Container telemetry is unavailable. Refresh to try again.')
    return { generatedAt: aiText(row.generated_at), unavailable: aiText(row.unavailable_reason), items: list.map(item => {
        const container = aiRecord(item)
        return { id: aiText(container.id), name: aiText(container.name), image: aiText(container.image), status: aiText(container.status), health: aiText(container.health) || aiText(container.state) || aiText(container.status) || 'Unknown' }
    }).filter(container => /(^|_)ai(_|$)|model|parser|gpt/i.test(`${container.name} ${container.image}`)) }
}
async function read(settings: AppSettings, endpoint: string, signal: AbortSignal) {
    if (!settings.authToken || !settings.userId) throw new AiMetricsError('Sign in to inspect AI operations.', 401)
    const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 20000)
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
    try {
        if (controller.signal.aborted) throw new AiMetricsError('AI metrics read cancelled.')
        const response = await apiFetch(settings, endpoint, { signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } })
        if (!response.ok) throw new AiMetricsError(response.status === 401 || response.status === 403 ? 'AI access could not be verified. Refresh manually before continuing.' : 'AI telemetry is unavailable. Refresh to try again.', response.status)
        const body = await response.text()
        if (aiUtf8Bytes(body) > aiMetricsLimit) throw new AiMetricsError('AI telemetry exceeded its size limit.')
        return JSON.parse(body) as unknown
    } catch (cause) {
        if (cause instanceof AiMetricsError) throw cause
        throw new AiMetricsError('AI telemetry is unavailable. Refresh to try again.')
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
export async function loadAiEconomics(settings: AppSettings, signal: AbortSignal) { return parseAiEconomics(await read(settings, aiMetricsEndpoint(settings.siteBaseUrl, 'api/backend/ai/economics?days=30'), signal)) }
export async function loadAiContainers(settings: AppSettings, signal: AbortSignal) { return parseAiContainers(await read(settings, aiMetricsEndpoint(settings.apiBaseUrl, 'docker'), signal)) }
// Existing model discovery deliberately projects only name/TPS/status. Rich sensors arrive on the existing live channel.
export async function loadAiMetricTargets(settings: AppSettings, signal: AbortSignal) {
    if (signal.aborted) throw new AiMetricsError('AI metrics read cancelled.')
    try {
        const values = await fetchAiModels(settings, signal)
        if (signal.aborted) throw new AiMetricsError('AI metrics read cancelled.')
        return values.map(value => parseAiClient({ name: value.name, model: value.model }))
    } catch (cause) {
        const status = cause && typeof cause === 'object' && 'status' in cause ? Number(cause.status) : 0
        throw new AiMetricsError([401, 403].includes(status) ? 'AI access could not be verified. Refresh manually before continuing.' : 'Model discovery is unavailable. Refresh to try again.', Number.isInteger(status) ? status : 0)
    }
}
export function aiMean(values: NullableNumber[]) { return values.length && values.every(value => value !== null) ? values.reduce<number>((sum, value) => sum + value!, 0) / values.length : null }
export function aiSum(values: NullableNumber[]) { return values.length && values.every(value => value !== null) ? values.reduce<number>((sum, value) => sum + value!, 0) : null }
export function aiSummary(clients: AiMetricsClient[]) {
    const load = (key: 'ram' | 'cpu' | 'gpu') => aiMean(clients.map(client => client[key] ? aiMean(client[key]!.map(sensor => sensor.load)) : null))
    const lanes = clients.flatMap(client => client.lanes || []), knownLanes = clients.every(client => client.lanes !== null)
    return { ram: load('ram'), cpu: load('cpu'), gpu: load('gpu'), tps: aiMean(clients.map(client => client.model.tps)), active: knownLanes ? aiSum(lanes.map(lane => lane.active)) : null, available: knownLanes ? aiSum(lanes.map(lane => lane.available)) : null, maximum: knownLanes ? aiSum(lanes.map(lane => lane.maximum)) : null, watts: aiSum(clients.map(client => client.watts)), monthlyKwh: aiSum(clients.map(client => client.monthlyKwh)) }
}
export const aiValue = (value: NullableNumber, suffix = '', decimals = 1) => value === null ? 'Unavailable' : `${value.toFixed(decimals)}${suffix}`
export const aiPercent = (value: NullableNumber) => aiValue(value === null ? null : value * 100, '%', 0)
