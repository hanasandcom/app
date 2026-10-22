import { useEffect, useMemo, useRef, useState } from 'react'
import { BackHandler, Pressable, Text, TextInput, View } from 'react-native'
import type { AppSettings } from '../types'
import { apiFetch } from '../lib/api'
import { workspacePageDefinition, type WorkspaceField, type WorkspaceSection } from '../data/site-navigation'
import { GlassCard, InlineNotice, PillButton, Screen, SectionTitle } from '../components/ui'
import { useAppTheme } from '../theme/context'
import { spacing } from '../theme/tokens'

type RecordValue = Record<string, unknown>
type SectionState = { definition: WorkspaceSection; rows: RecordValue[]; error?: string; notice?: string }
type SelectedItem = { section: WorkspaceSection; row: RecordValue; title: string }
const object = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}

/** Reads only explicitly described fields; response objects and secrets are never serialized into UI. */
export function workspaceValue(value: unknown, path: string): unknown {
    for (const alternative of path.split('|')) {
        const result = alternative.split('.').reduce<unknown>((current, key) => object(current)[key], value)
        if (result !== null && result !== undefined && result !== '') return result
    }
    return undefined
}
export function workspaceFieldValue(row: RecordValue, [, path, format]: WorkspaceField): string | null {
    const value = workspaceValue(row, path)
    if (value === null || value === undefined || value === '') return null
    if (format === 'masked') return typeof value === 'string' ? `${value.slice(0, 6)}••••••••` : '••••••••'
    if (Array.isArray(value)) return value.every(item => ['string', 'number'].includes(typeof item)) ? value.join(', ') : null
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (!['string', 'number'].includes(typeof value)) return null
    if (format === 'date') {
        const date = new Date(String(value))
        return Number.isNaN(date.getTime()) ? null : date.toLocaleString()
    }
    if (format === 'bytes') {
        const bytes = Number(value)
        if (!Number.isFinite(bytes) || bytes < 0) return null
        const unit = bytes > 0 ? Math.max(0, Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)))) : 0
        return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`
    }
    if (format === 'percent') return `${String(value).replace(/%$/, '')}%`
    return typeof value === 'number' ? value.toLocaleString() : value as string
}
export function workspaceRequestUrl(settings: AppSettings, definition: WorkspaceSection, detailId?: string, search?: string) {
    const organizationId = settings.selectedOrganizationId && settings.selectedOrganizationId !== 'personal' ? settings.selectedOrganizationId : ''
    const endpoint = (detailId === undefined ? definition.endpoint : definition.detailEndpoint || definition.endpoint)
        .replace(':userId', encodeURIComponent(settings.impersonatingUserId || settings.userId))
        .replace(':organizationId', encodeURIComponent(organizationId))
        .replace(':id', encodeURIComponent(detailId || ''))
    const base = definition.origin === 'site' ? settings.siteBaseUrl : settings.apiBaseUrl
    const url = new URL(`${base.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`)
    if (url.protocol !== 'https:') throw new Error('Workspace services require a secure HTTPS connection.')
    if (organizationId) url.searchParams.set('organizationId', organizationId)
    if (search && definition.searchParam) url.searchParams.set(definition.searchParam, search)
    return url.toString()
}
export async function fetchWorkspaceSection(settings: AppSettings, definition: WorkspaceSection, signal: AbortSignal, detailId?: string, search?: string) {
    const url = workspaceRequestUrl(settings, definition, detailId, search)
    const response = await apiFetch(settings, url, {
        signal,
        headers: {
            Authorization: `Bearer ${settings.authToken}`, id: settings.userId,
            ...(settings.impersonationToken ? { 'x-impersonation-token': settings.impersonationToken } : {}),
        },
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
        const error = workspaceValue(payload, 'error.message|error')
        throw new Error(typeof error === 'string' ? error : `Unable to load this service (${response.status}).`)
    }
    if (payload === null) throw new Error('The service returned an invalid response.')
    return payload
}
export function workspaceRows(payload: unknown, definition: WorkspaceSection): RecordValue[] {
    if (definition.listPath === undefined) {
        const row = object(payload)
        if (!Object.keys(row).length) throw new Error('The service returned an invalid summary.')
        return [row]
    }
    const value = definition.listPath === '' ? payload : workspaceValue(payload, definition.listPath)
    if (!Array.isArray(value)) throw new Error('The service returned an invalid list.')
    return value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as RecordValue[]
}
export function workspaceFiles(value: unknown): RecordValue[] {
    if (!Array.isArray(value)) return []
    return value.flatMap(item => {
        const file = object(item)
        if (typeof file.id !== 'string') return []
        return file.type === 'folder' ? workspaceFiles(file.children) : [file]
    })
}

function itemTitle(row: RecordValue, definition: WorkspaceSection, fallback: string) {
    const title = workspaceValue(row, definition.titlePath || 'name|title|id')
    return typeof title === 'string' || typeof title === 'number' ? String(title) : fallback
}

export function WorkspacePageScreen({ settings, path, title }: { settings: AppSettings; path: string; title: string }) {
    const theme = useAppTheme()
    const definition = workspacePageDefinition(path)
    const [sections, setSections] = useState<SectionState[]>([])
    const [activeSection, setActiveSection] = useState(0)
    const [selected, setSelected] = useState<SelectedItem | null>(null)
    const [detail, setDetail] = useState<RecordValue | null>(null)
    const [detailFiles, setDetailFiles] = useState<RecordValue[]>([])
    const [error, setError] = useState('')
    const [query, setQuery] = useState('')
    const [serverSearch, setServerSearch] = useState('')
    const [loading, setLoading] = useState(false)
    const [detailLoading, setDetailLoading] = useState(false)
    const [revision, setRevision] = useState(0)
    const sequence = useRef(0)
    const selectedOrganization = settings.selectedOrganizationId && settings.selectedOrganizationId !== 'personal'
    const needsOrganization = definition?.requiresOrganization && !selectedOrganization
    const authenticated = Boolean(settings.authToken && settings.userId)
    const styles = useMemo(() => ({
        row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
        card: { gap: spacing.md },
        heading: { color: theme.text, fontWeight: '700' as const, fontSize: 16 },
        text: { color: theme.textMuted, fontSize: 14, lineHeight: 21 },
        label: { color: theme.textSoft, fontSize: 12 },
        input: { minHeight: 46, borderRadius: 16, borderWidth: 1, borderColor: theme.surfaceBorderSoft, color: theme.text, backgroundColor: theme.backgroundRaised, paddingHorizontal: 14 },
        item: { borderTopWidth: 1, borderColor: theme.surfaceBorderSoft, paddingVertical: spacing.md, gap: spacing.sm },
    }), [theme])

    useEffect(() => {
        setActiveSection(0); setSelected(null); setDetail(null); setQuery(''); setServerSearch('')
    }, [path, settings.userId, settings.impersonationToken, settings.selectedOrganizationId])

    useEffect(() => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 20_000)
        let active = true
        setSections([]); setError('')
        if (!definition || needsOrganization || !authenticated) { setLoading(false); clearTimeout(timeout); return }
        setLoading(true)
        const requests = new Map<string, Promise<unknown>>()
        const work = definition.sections.map(async section => {
            const url = workspaceRequestUrl(settings, section, undefined, serverSearch)
            let pending = requests.get(url)
            if (!pending) { pending = fetchWorkspaceSection(settings, section, controller.signal, undefined, serverSearch); requests.set(url, pending) }
            const payload = await pending
            return { definition: section, rows: workspaceRows(payload, section), notice: typeof object(payload).unavailable_reason === 'string' ? String(object(payload).unavailable_reason) : undefined }
        })
        void Promise.allSettled(work).then(results => {
            if (!active) return
            setSections(results.map((result, index) => result.status === 'fulfilled' ? result.value : {
                definition: definition.sections[index], rows: [], error: controller.signal.aborted ? 'The service took too long to respond. Try refreshing.' : message(result.reason),
            }))
            setLoading(false)
            clearTimeout(timeout)
        })
        return () => { active = false; controller.abort(); clearTimeout(timeout) }
    }, [path, settings.apiBaseUrl, settings.siteBaseUrl, settings.authToken, settings.userId, settings.impersonationToken, settings.selectedOrganizationId, revision, serverSearch])

    useEffect(() => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 20_000)
        const requestId = ++sequence.current
        setDetail(null); setDetailFiles([]); setError('')
        if (!selected?.section.detailEndpoint) { setDetailLoading(false); clearTimeout(timeout); return }
        const key = workspaceValue(selected.row, selected.section.detailKey || 'id')
        if (typeof key !== 'string' && typeof key !== 'number') { setError('This item has no detail identifier.'); setDetailLoading(false); clearTimeout(timeout); return }
        setDetailLoading(true)
        void fetchWorkspaceSection(settings, selected.section, controller.signal, String(key)).then(payload => {
            if (requestId !== sequence.current) return
            const data = selected.section.detailObjectPath ? workspaceValue(payload, selected.section.detailObjectPath) : payload
            const row = Array.isArray(data) ? object(data[0]) : object(data)
            if (!Object.keys(row).length) throw new Error('The service returned an invalid item.')
            setDetail(row)
            if (selected.section.detailTreePath) setDetailFiles(workspaceFiles(workspaceValue(payload, selected.section.detailTreePath)))
        }).catch(cause => { if (requestId === sequence.current && !controller.signal.aborted) setError(message(cause)); else if (requestId === sequence.current) setError('The item took too long to load. Try again.') })
            .finally(() => { if (requestId === sequence.current) setDetailLoading(false); clearTimeout(timeout) })
        return () => { sequence.current += 1; controller.abort(); clearTimeout(timeout) }
    }, [selected, settings.authToken, settings.userId, settings.impersonationToken, settings.selectedOrganizationId])

    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (!selected) return false
            setSelected(null)
            return true
        })
        return () => subscription.remove()
    }, [selected])

    function fields(row: RecordValue, definitions: WorkspaceField[], limit?: number) {
        return definitions.flatMap(field => {
            const value = workspaceFieldValue(row, field)
            return value === null ? [] : [{ label: field[0], value }]
        }).slice(0, limit).map(field => <View key={field.label} style={{ gap: 3 }}><Text style={styles.label}>{field.label}</Text><Text selectable numberOfLines={limit ? 2 : undefined} style={styles.text}>{field.value}</Text></View>)
    }
    const section = sections[activeSection]
    const filteredRows = section?.rows.filter(row => !query.trim() || [itemTitle(row, section.definition, ''), ...section.definition.fields.map(field => workspaceFieldValue(row, field) || '')].join(' ').toLowerCase().includes(query.trim().toLowerCase())) || []
    const selectedFields = selected?.section.detailFields || selected?.section.fields || []
    const unsupported = !definition
    return <Screen key={`${path}:${selected ? 'detail' : 'list'}`} title={selected ? selected.title : title} subtitle={selectedOrganization ? 'Organization workspace' : 'Personal workspace'}
        left={selected ? <PillButton label='Back' small onPress={() => setSelected(null)} /> : undefined}
        right={!selected && definition ? <PillButton label={loading ? 'Loading…' : 'Refresh'} small disabled={loading || needsOrganization || !authenticated} onPress={() => setRevision(value => value + 1)} /> : undefined}>
        {!authenticated && <InlineNotice message='Sign in to view your workspace.' />}
        {needsOrganization && <InlineNotice message='Select an organization from Organizations to view this page.' />}
        {unsupported && <InlineNotice message='This service does not have a native workflow yet.' />}
        {!!error && <InlineNotice message={error} />}
        {loading && <GlassCard><Text style={styles.text}>Loading {title.toLowerCase()}…</Text></GlassCard>}
        {selected ? <GlassCard style={styles.card}>
            <SectionTitle eyebrow='Details' title={selected.title} />
            {detailLoading && <Text style={styles.text}>Loading details…</Text>}
            {fields(detail || selected.row, detail ? selectedFields : selected.section.fields)}
            {detailFiles.length > 0 && <Text style={styles.heading}>Files</Text>}
            {detailFiles.map(file => <PillButton key={String(file.id)} label={String(file.name || file.alias || file.id)} small onPress={() => setSelected({ row: file, title: String(file.name || file.id), section: { ...selected.section, detailEndpoint: 'share/:id', detailKey: 'id', detailObjectPath: undefined, detailTreePath: undefined } })} />)}
            {!!error && <PillButton label='Retry details' small onPress={() => setSelected({ ...selected })} />}
        </GlassCard> : <>
            {sections.length > 1 && <View style={styles.row}>{sections.map((item, index) => <PillButton key={`${item.definition.label}:${index}`} label={`${item.definition.label}${item.definition.listPath === undefined ? '' : ` · ${item.rows.length}`}`} small tone={index === activeSection ? 'accent' : 'default'} onPress={() => { setActiveSection(index); setQuery('') }} />)}</View>}
            {section && <GlassCard style={styles.card}>
                <SectionTitle eyebrow={section.definition.listPath === undefined ? 'Overview' : 'Records'} title={section.definition.label} />
                {!!section.error && <InlineNotice message={section.error} />}
                {!!section.notice && <InlineNotice message={section.notice} />}
                {section.definition.listPath !== undefined && <>
                    <TextInput accessibilityLabel='Search records' value={query} onChangeText={setQuery} onSubmitEditing={() => { if (section.definition.searchParam) setServerSearch(query.trim()) }} placeholder={section.definition.searchParam ? 'Search records' : 'Filter loaded records'} placeholderTextColor={theme.textSoft} autoCapitalize='none' autoCorrect={false} returnKeyType='search' style={styles.input} />
                    {section.definition.searchParam && <View style={styles.row}><PillButton label='Search service' small disabled={loading} onPress={() => setServerSearch(query.trim())} />{!!serverSearch && <PillButton label='Clear' small onPress={() => { setQuery(''); setServerSearch('') }} />}</View>}
                    {!section.error && <Text style={styles.label}>{filteredRows.length} of {section.rows.length} loaded records</Text>}
                </>}
                {!section.error && !filteredRows.length && <Text style={styles.text}>{query ? 'No matching records.' : 'No records found.'}</Text>}
                {section.definition.listPath === undefined ? section.rows.map((row, index) => <View key={index} style={styles.card}>{fields(row, section.definition.fields)}</View>) : filteredRows.map((row, index) => {
                    const rowTitle = itemTitle(row, section.definition, `${section.definition.label} ${index + 1}`)
                    return <Pressable key={`${String(row.id || row.name || row.alias || index)}`} accessibilityRole='button' accessibilityLabel={`View ${rowTitle}`} style={styles.item} onPress={() => setSelected({ section: section.definition, row, title: rowTitle })}>
                        <Text numberOfLines={2} style={styles.heading}>{rowTitle}</Text>
                        {fields(row, section.definition.fields, 3)}
                        <Text style={styles.label}>View details</Text>
                    </Pressable>
                })}
            </GlassCard>}
        </>}
    </Screen>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Unable to load this service.' }
