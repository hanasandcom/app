import type { AppSettings } from '../../types'
import { getHeader } from '../../lib/headers'
import { apiFetch } from '../../lib/api'
import { CaseError, caseId, changeBody, endpoint, mergeIds, needsHumanReview, organization, own, parseCase, parseRepository, repositoryId, row, rows, safeUrl, text, type CaseChange } from './model'
export type Transport = (settings: AppSettings, url: string, init: RequestInit) => Promise<Response>
export type Options = { transport?: Transport; timeoutMs?: number }
export type Guard = () => boolean
function query(s: AppSettings, values: Record<string, string> = {}, org: string | undefined = organization(s)) {
    return new URLSearchParams({ ...(org ? { organizationId: org } : {}), ...values }).toString()
}
function utf8Size(v: string) { let size = 0; for (const c of v) { const n = c.codePointAt(0)!; size += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4 } return size }
async function request(s: AppSettings, path: string, signal: AbortSignal, options: Options, method = 'GET', body?: unknown) {
    if (!s.userId || !s.authToken) throw new CaseError('Sign in to view cases.', 401)
    const url = endpoint(s, path), controller = new AbortController()
    let dispatched = false, rejectAbort: (v: Error) => void = () => {}
    const mutation = method !== 'GET', abort = () => controller.abort()
    const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject })
    const onAbort = () => rejectAbort(new CaseError(mutation && dispatched ? 'The change outcome is unknown. Refresh and review before another change.' : 'Case request interrupted.', 0, mutation && dispatched))
    controller.signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, options.timeoutMs ?? 20000)
    const run = async () => {
        if (controller.signal.aborted) throw new CaseError('Case request cancelled.')
        dispatched = true
        const res = await (options.transport || apiFetch)(s, url, { method, signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json', Authorization: `Bearer ${s.authToken}`, id: s.userId, ...(s.impersonationToken ? { 'x-impersonation-token': s.impersonationToken } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
        if (Number(getHeader(res.headers, 'content-length')) > 8 * 1024 * 1024) throw new CaseError('Case response exceeded the 8 MiB limit.', res.status, mutation)
        const content = await res.text()
        if (content.length > 8 * 1024 * 1024 || utf8Size(content) > 8 * 1024 * 1024) throw new CaseError('Case response exceeded the 8 MiB limit.', res.status, mutation)
        if (!res.ok) throw new CaseError(res.status === 409 ? 'The case or repository changed. Refresh and review before trying again.' : [401, 403].includes(res.status) ? 'Current case access could not be verified. Refresh manually.' : res.status === 404 ? 'This case or repository is no longer available.' : res.status === 400 ? 'The service rejected this change. Check its required fields.' : 'Cases is temporarily unavailable.', res.status, mutation && (res.status >= 500 || res.status === 408))
        try { return { status: res.status, body: row(JSON.parse(content)) } } catch { throw new CaseError('The service returned an unreadable receipt.', res.status, mutation) }
    }
    try { return await Promise.race([run(), interrupted]) }
    catch (e) { if (e instanceof CaseError) throw e; throw new CaseError(mutation && dispatched ? 'The change outcome is unknown. Refresh and review before another change.' : 'Could not load cases. Refresh to try again.', 0, mutation && dispatched) }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onAbort) }
}
const writer = (s: AppSettings, current: Guard, signal: AbortSignal) => { if (!own(s) || !current() || signal.aborted) throw new CaseError('Return to your current own-account case before making changes.', 403) }
export function caseServices(s: AppSettings, options: Options = {}) {
    const list = async (signal: AbortSignal) => rows((await request(s, `cases/monitoring?${query(s, { view: 'summary' })}`, signal, options)).body.items).map(v => parseCase(v, s))
    const detail = async (id: string, signal: AbortSignal, page = 0, snapshot?: string) => {
        id = caseId(id)
        if (!Number.isSafeInteger(page) || page < 0 || page > 100000 || page > 0 && !Number.isFinite(Date.parse(snapshot || ''))) throw new CaseError('Refresh case events before paging.')
        const item = parseCase((await request(s, `cases/monitoring/${id}?${query(s, { eventsPage: String(page), ...(snapshot ? { eventsAt: snapshot } : {}) })}`, signal, options)).body.case, s, true)
        if (item.eventPage !== page || snapshot && item.eventSnapshot !== snapshot) throw new CaseError('Event history changed. Refresh the case.')
        // Merged case aliases may resolve to a different canonical HA number; preserve that response identity.
        return item
    }
    const repositories = async (signal: AbortSignal) => rows((await request(s, `cases/repositories?${query(s)}`, signal, options)).body.items).map(v => parseRepository(v, s))
    const development = async (id: string, offset: number, signal: AbortSignal) => {
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 9999999) throw new CaseError('Invalid development history page.')
        const r = (await request(s, `cases/development?${query(s, { caseId: caseId(id), offset: String(offset) })}`, signal, options)).body
        if (typeof r.hasMore !== 'boolean') throw new CaseError('Development history page is incomplete.')
        return { items: rows(r.items, 50), hasMore: r.hasMore, offset }
    }
    const repositoryAuthority = async (id: string, signal: AbortSignal, current: Guard) => {
        writer(s, current, signal)
        const repo = (await repositories(signal)).find(v => v.id === repositoryId(id))
        writer(s, current, signal)
        if (!repo?.canManage) throw new CaseError('Current repository management access is required.', 403)
        return repo
    }
    const confirmOk = (r: { body: Record<string, unknown> }) => { if (r.body.ok !== true) throw new CaseError('The change receipt could not be verified. Refresh and review.', 0, true) }
    return {
        list, detail, repositories, development,
        async connectionAccess(signal: AbortSignal) {
            if (!own(s)) return false
            const org = organization(s)
            if (!org) return true
            const r = row((await request(s, `organizations/${encodeURIComponent(org)}`, signal, options)).body.organization)
            if (r.id !== org || !['active', 'archived', 'deleted'].includes(text(r.lifecycleStatus)) || !text(r.role)) throw new CaseError('Repository connection access is unavailable.')
            return r.id === org && r.lifecycleStatus === 'active' && ['owner', 'admin'].includes(text(r.role))
        },
        async update(id: string, change: CaseChange, signal: AbortSignal, current: Guard) {
            writer(s, current, signal); const body = changeBody(change), fresh = await detail(id, signal)
            writer(s, current, signal)
            if (!fresh.canManage || fresh.id !== caseId(id)) throw new CaseError('Refresh the current manageable case.', 403)
            if (body.confirmResolutionId && (!needsHumanReview(fresh) || fresh.resolution?.id !== body.confirmResolutionId)) throw new CaseError('Resolution changed. Refresh before confirming.', 409)
            confirmOk(await request(s, `cases/monitoring/${fresh.id}?${query(s)}`, signal, options, 'PATCH', body))
        },
        async merge(target: string, sources: string[], signal: AbortSignal, current: Guard) {
            writer(s, current, signal); const body = mergeIds(target, sources)
            const all = await Promise.all([body.targetId, ...body.sourceIds].map(id => detail(id, signal)))
            writer(s, current, signal)
            if (all.some((c, i) => !c.canManage || c.id !== [body.targetId, ...body.sourceIds][i] || c.automationId !== all[0].automationId)) throw new CaseError('Select current manageable cases for the same health check.', 409)
            const r = await request(s, `cases/monitoring/merge?${query(s)}`, signal, options, 'POST', body)
            confirmOk(r)
            if (r.body.targetId !== body.targetId || !Array.isArray(r.body.mergedIds) || r.body.mergedIds.length !== sources.length || sources.some(id => !(r.body.mergedIds as unknown[]).includes(id))) throw new CaseError('The merge receipt could not be verified. Refresh and review.', 0, true)
        },
        async commits(repository: string, search: string, cursor: string | undefined, signal: AbortSignal) {
            if (search.length > 200 || cursor !== undefined && !/^[a-f0-9]{40,64}$/i.test(cursor)) throw new CaseError('Refresh and choose a valid commit page.')
            const r = (await request(s, `cases/development/commits?${query(s, { repositoryId: repositoryId(repository), search, ...(cursor ? { cursor } : {}) })}`, signal, options)).body
            if (r.nextCursor !== null && r.nextCursor !== undefined && !/^[a-f0-9]{40,64}$/i.test(text(r.nextCursor))) throw new CaseError('Commit history cursor is invalid.')
            const items = rows(r.items, 100)
            if (items.some(v => !/^[a-f0-9]{40,64}$/i.test(text(v.external_id)))) throw new CaseError('Commit history is incomplete.')
            return { items, nextCursor: text(r.nextCursor) || undefined }
        },
        async link(id: string, repository: string, commit: string, signal: AbortSignal, current: Guard) {
            writer(s, current, signal)
            if (!/^[a-f0-9]{40,64}$/i.test(commit)) throw new CaseError('Choose a commit from current history.')
            const fresh = await detail(id, signal)
            writer(s, current, signal)
            if (fresh.id !== caseId(id)) throw new CaseError('Case identity changed. Refresh before linking.', 409)
            await repositoryAuthority(repository, signal, current)
            writer(s, current, signal)
            confirmOk(await request(s, `cases/development/commits?${query(s)}`, signal, options, 'POST', { repositoryId: repository, commit, caseId: caseId(id) }))
        },
        async connect(provider: string, url: string, signal: AbortSignal, current: Guard) {
            writer(s, current, signal)
            if (!['github', 'forgejo', 'gitlab'].includes(provider)) throw new CaseError('Choose a supported repository provider.')
            const repositoryUrl = safeUrl(url)
            const org = organization(s)
            if (org) {
                const r = row((await request(s, `organizations/${encodeURIComponent(org)}`, signal, options)).body.organization)
                if (r.id !== org || r.lifecycleStatus !== 'active' || !['owner', 'admin'].includes(text(r.role))) throw new CaseError('Active organization owner or administrator access is required.', 403)
            }
            writer(s, current, signal)
            const r = await request(s, `cases/repositories?${query(s)}`, signal, options, 'POST', { provider, repositoryUrl })
            const id = text(r.body.id), secret = text(r.body.secret), webhookPath = text(r.body.webhookPath)
            if (r.status !== 201 || !/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(secret) || webhookPath !== `/api/cases/repository-events/${id}`) throw new CaseError('Repository may be connected, but its one-time secret receipt is unavailable. Refresh and review; do not connect again automatically.', 0, true)
            return { id, secret, webhookUrl: `${new URL(s.apiBaseUrl).origin}${webhookPath}` }
        },
        async disconnect(repository: string, signal: AbortSignal, current: Guard) {
            const repo = await repositoryAuthority(repository, signal, current)
            writer(s, current, signal)
            // A personal repository can be visible from an organization case; retain its actual personal scope.
            const params = new URLSearchParams(repo.organizationId ? { organizationId: repo.organizationId } : {})
            confirmOk(await request(s, `cases/repositories/${repo.id}?${params}`, signal, options, 'DELETE'))
        },
    }
}
export type CaseServices = ReturnType<typeof caseServices>
