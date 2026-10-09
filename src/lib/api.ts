import type { AgentAutomation, AgentAutomationPayload, AgentAutomationRun, AiFileSummary, AiRunDetails, AiToolUseSummary, AppSettings, DashboardRole, DashboardUser, DashboardUserRoleAssignment, DesktopAgentPresence, DesktopAgentStatus, GptClient, HanasandAuthSession, MailAddress, MailboxItem, MailMessage, MailMessageSummary, MailOverview, MailSendResult, ManagedCronJob, Note, ShareSummary, ShareTreeItem } from '../types'

export class PendingDeletionError extends Error {
    id: string
    deletionScheduledAt: string
    restoreToken: string

    constructor(payload: Record<string, unknown>) {
        super(stringValue(payload.error) || 'Account pending deletion.')
        this.name = 'PendingDeletionError'
        this.id = stringValue(payload.id)
        this.deletionScheduledAt = stringValue(payload.deletion_scheduled_at)
        this.restoreToken = stringValue(payload.restore_token)
    }
}

function headers(settings: AppSettings) {
    const next: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: settings.authToken ? `Bearer ${settings.authToken}` : '',
        id: settings.userId || '',
    }
    if (settings.impersonationToken) {
        next['x-impersonation-token'] = settings.impersonationToken
    }
    return next
}

function requireAppAuth(settings: AppSettings, purpose: string) {
    if (!settings.apiBaseUrl || !settings.authToken || !settings.userId) {
        throw new Error(`Log in again to ${purpose}.`)
    }
}

function requireCdnAuth(settings: AppSettings, purpose: string) {
    if (!settings.cdnBaseUrl || !settings.authToken || !settings.userId) {
        throw new Error(`Log in again to ${purpose}.`)
    }
}

function baseUrl(value: string) {
    return value.trim().replace(/\/+$/, '')
}

function pathPart(value: string) {
    return value.trim().replace(/^\/+/, '')
}

function isPrivateNetworkHost(hostname: string) {
    const host = hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) return true
    if (host.startsWith('10.') || host.startsWith('192.168.')) return true
    const match = host.match(/^172\.(\d{1,2})\./)
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31)
}

function assertSecureTransport(url: string) {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') return
    if (parsed.protocol === 'http:' && isPrivateNetworkHost(parsed.hostname)) return
    throw new Error(`Blocked insecure plaintext endpoint: ${parsed.origin}. Use HTTPS for Hanasand services.`)
}

function joinUrl(base: string, path: string) {
    const cleanBase = baseUrl(base)
    const cleanPath = pathPart(path)
    const next = cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase
    assertSecureTransport(next)
    return next
}

function desktopAgentBases(settings: AppSettings) {
    const primary = settings.desktopAgentBaseUrl.trim()
    if (!primary) return ['http://127.0.0.1:45731', 'http://localhost:45731']
    const fallback = primary.replace('127.0.0.1', 'localhost')
    return fallback === primary ? [primary] : [primary, fallback]
}

async function fetchDesktopAgentPresence(settings: AppSettings) {
    requireAppAuth(settings, 'discover the desktop agent')
    const response = await fetch(joinUrl(settings.apiBaseUrl, 'desktop-agent/presence'), {
        headers: headers(settings),
    })
    if (!response.ok) {
        throw new Error(`Desktop agent discovery failed with HTTP ${response.status}.`)
    }
    const payload = await response.json().catch(() => null) as { agents?: DesktopAgentPresence[] } | null
    return Array.isArray(payload?.agents) ? payload.agents : []
}

function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount))
}

function sha256Hex(input: string) {
    const bytes: number[] = []
    for (let i = 0; i < input.length; i += 1) {
        const code = input.charCodeAt(i)
        if (code < 0x80) {
            bytes.push(code)
        } else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
        } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
            const next = input.charCodeAt(i + 1)
            if (next >= 0xdc00 && next <= 0xdfff) {
                const point = 0x10000 + (((code & 0x3ff) << 10) | (next & 0x3ff))
                bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f))
                i += 1
            }
        } else {
            bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
        }
    }

    const bitLength = bytes.length * 8
    bytes.push(0x80)
    while ((bytes.length % 64) !== 56) bytes.push(0)
    const high = Math.floor(bitLength / 0x100000000)
    const low = bitLength >>> 0
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff)
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff)

    const constants = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]
    const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
    const words = new Array<number>(64)

    for (let chunk = 0; chunk < bytes.length; chunk += 64) {
        for (let i = 0; i < 16; i += 1) {
            const offset = chunk + i * 4
            words[i] = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
        }
        for (let i = 16; i < 64; i += 1) {
            const s0 = rightRotate(words[i - 15], 7) ^ rightRotate(words[i - 15], 18) ^ (words[i - 15] >>> 3)
            const s1 = rightRotate(words[i - 2], 17) ^ rightRotate(words[i - 2], 19) ^ (words[i - 2] >>> 10)
            words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0
        }

        let [a, b, c, d, e, f, g, h] = hash
        for (let i = 0; i < 64; i += 1) {
            const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)
            const ch = (e & f) ^ (~e & g)
            const temp1 = (h + s1 + ch + constants[i] + words[i]) >>> 0
            const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)
            const maj = (a & b) ^ (a & c) ^ (b & c)
            const temp2 = (s0 + maj) >>> 0
            h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
        }

        hash[0] = (hash[0] + a) >>> 0
        hash[1] = (hash[1] + b) >>> 0
        hash[2] = (hash[2] + c) >>> 0
        hash[3] = (hash[3] + d) >>> 0
        hash[4] = (hash[4] + e) >>> 0
        hash[5] = (hash[5] + f) >>> 0
        hash[6] = (hash[6] + g) >>> 0
        hash[7] = (hash[7] + h) >>> 0
    }

    return hash.map(value => value.toString(16).padStart(8, '0')).join('')
}

function desktopAgentSessionCertificate(settings: AppSettings) {
    const userId = settings.userId.trim()
    const authToken = settings.authToken.trim()
    if (!userId || !authToken) return ''
    return sha256Hex(`hanasand-desktop-agent-session-v1\n${userId}\n${authToken}`)
}

function desktopAgentProofHeaders(path: string, init: RequestInit | undefined, certificate: string) {
    if (!certificate) return init
    const method = (init?.method || 'GET').toUpperCase()
    const target = `/${pathPart(path)}`
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    const proof = sha256Hex(`${certificate}\n${method}\n${target}\n${timestamp}\n${nonce}`)
    return {
        ...init,
        headers: {
            ...(init?.headers || {}),
            'X-Hanasand-Session-Timestamp': timestamp,
            'X-Hanasand-Session-Nonce': nonce,
            'X-Hanasand-Session-Proof': proof,
        },
    }
}

async function fetchDesktopAgentPath(settings: AppSettings, path: string, init?: RequestInit) {
    const bases = desktopAgentBases(settings)
    const certificate = desktopAgentSessionCertificate(settings)

    let lastError: unknown
    for (const base of bases) {
        try {
            const response = await fetch(joinUrl(base, path), desktopAgentProofHeaders(path, init, certificate))
            if (response.status !== 401) return response
            lastError = new Error('Desktop agent rejected this login session.')
        } catch (error) {
            lastError = error
        }
    }

    try {
        const agents = await fetchDesktopAgentPresence(settings)
        for (const agent of agents) {
            for (const endpoint of agent.endpoints || []) {
                try {
                    const response = await fetch(joinUrl(endpoint, path), desktopAgentProofHeaders(path, init, certificate))
                    if (response.status !== 401) return response
                    lastError = new Error('Desktop agent rejected this login session.')
                } catch (error) {
                    lastError = error
                }
            }
        }
    } catch (error) {
        lastError = error
    }

    throw lastError instanceof Error ? lastError : new Error('Desktop agent is unreachable.')
}

function segment(value: string) {
    return encodeURIComponent(value)
}

function stringValue(value: unknown) {
    return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown) {
    return typeof value === 'boolean' ? value : undefined
}

function asRecord(value: unknown) {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function normalizeAuthSession(value: unknown): HanasandAuthSession {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    const token = stringValue(entry.token)
    if (!id || !token) {
        throw new Error(stringValue(entry.error) || 'Unable to sign in.')
    }
    const roles = Array.isArray(entry.roles)
        ? entry.roles.map(role => typeof role === 'string' ? role : stringValue(asRecord(role).id) || stringValue(asRecord(role).name)).filter(Boolean)
        : undefined
    return {
        id,
        name: stringValue(entry.name) || undefined,
        avatar: stringValue(entry.avatar) || null,
        roles: roles?.length ? roles : undefined,
        token,
        expiresAt: stringValue(entry.expires_at) || stringValue(entry.expiresAt) || undefined,
    }
}

async function readJsonResponse(response: Response) {
    const payload = await response.json().catch(() => null)
    const entry = asRecord(payload)
    if (response.status === 423 && entry.pending_deletion === true) {
        throw new PendingDeletionError(entry)
    }
    if (response.ok) return payload
    const message = stringValue(entry.error) || `Request failed with HTTP ${response.status}.`
    throw new Error(message)
}

export async function loginToHanasand(settings: AppSettings, username: string, password: string) {
    const id = username.trim()
    if (!id || !password) {
        throw new Error('Enter username and password.')
    }
    const response = await fetch(joinUrl(settings.apiBaseUrl, `auth/login/${segment(id)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ password }),
    })
    return normalizeAuthSession(await readJsonResponse(response))
}

export async function createHanasandAccount(settings: AppSettings, username: string, name: string, password: string) {
    const id = username.trim()
    const displayName = name.trim()
    if (!id || !displayName || !password) {
        throw new Error('Enter username, name, and password.')
    }
    const response = await fetch(joinUrl(settings.apiBaseUrl, 'user'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id, name: displayName, password }),
    })
    return normalizeAuthSession(await readJsonResponse(response))
}

export async function refreshHanasandSession(settings: AppSettings) {
    requireAppAuth(settings, 'refresh your login session')
    const response = await fetch(joinUrl(settings.apiBaseUrl, `auth/token/${segment(settings.userId)}`), {
        headers: headers(settings),
    })
    return normalizeAuthSession(await readJsonResponse(response))
}

export async function requestPasswordResetCode(settings: AppSettings, username: string) {
    const id = username.trim()
    if (!id) throw new Error('Type your username first.')
    const response = await fetch(joinUrl(settings.apiBaseUrl, 'auth/password-reset/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id }),
    })
    await readJsonResponse(response)
}

export async function verifyPasswordResetCode(settings: AppSettings, username: string, code: string) {
    const id = username.trim()
    const resetCode = code.trim()
    if (!id || !/^\d{6}$/.test(resetCode)) throw new Error('Enter the 6 digit code.')
    const response = await fetch(joinUrl(settings.apiBaseUrl, 'auth/password-reset/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id, code: resetCode }),
    })
    const payload = asRecord(await readJsonResponse(response))
    const resetToken = stringValue(payload.resetToken)
    if (!resetToken) throw new Error('The reset code could not be verified.')
    return resetToken
}

export async function completePasswordReset(settings: AppSettings, username: string, resetToken: string, password: string) {
    const id = username.trim()
    if (!id || !resetToken || !password) throw new Error('Reset session expired. Send a new code.')
    const response = await fetch(joinUrl(settings.apiBaseUrl, 'auth/password-reset/complete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id, resetToken, password }),
    })
    await readJsonResponse(response)
}

export async function deleteHanasandAccount(settings: AppSettings) {
    requireAppAuth(settings, 'delete your account')
    const response = await fetch(joinUrl(settings.apiBaseUrl, 'user/self'), {
        method: 'DELETE',
        headers: headers(settings),
    })
    await readJsonResponse(response)
}

export async function restoreHanasandAccount(settings: AppSettings, id: string, restoreToken: string) {
    const response = await fetch(joinUrl(settings.apiBaseUrl, 'user/restore'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id, restoreToken }),
    })
    return normalizeAuthSession(await readJsonResponse(response))
}

function normalizeToolUses(value: unknown): AiToolUseSummary[] | undefined {
    if (!Array.isArray(value)) return undefined
    const tools = value.map(item => {
        const entry = asRecord(item)
        const name = stringValue(entry.name) || stringValue(entry.tool) || stringValue(entry.type)
        if (!name) return null
        return {
            name,
            summary: stringValue(entry.summary) || stringValue(entry.result) || stringValue(entry.input) || undefined,
            durationMs: numberValue(entry.durationMs) ?? numberValue(entry.duration_ms),
        }
    }).filter(Boolean) as AiToolUseSummary[]
    return tools.length ? tools : undefined
}

function normalizeFileSummaries(value: unknown): AiFileSummary[] | undefined {
    if (!Array.isArray(value)) return undefined
    const files = value.map(item => {
        const entry = asRecord(item)
        const path = stringValue(entry.path) || stringValue(entry.file) || stringValue(entry.name)
        if (!path) return null
        return {
            path,
            summary: stringValue(entry.summary) || stringValue(entry.description) || undefined,
            additions: numberValue(entry.additions),
            deletions: numberValue(entry.deletions),
        }
    }).filter(Boolean) as AiFileSummary[]
    return files.length ? files : undefined
}

function normalizeShare(value: unknown): ShareSummary | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null
    return {
        id,
        alias: stringValue(entry.alias) || null,
        path: stringValue(entry.path) || null,
        name: stringValue(entry.name) || null,
        timestamp: stringValue(entry.timestamp) || undefined,
        content: stringValue(entry.content) || undefined,
        locked: typeof entry.locked === 'boolean' ? entry.locked : undefined,
        parent: stringValue(entry.parent) || null,
        type: stringValue(entry.type) || null,
    }
}

function normalizeShareTree(value: unknown): ShareTreeItem[] {
    if (!Array.isArray(value)) return []
    return value.map(item => {
        const entry = asRecord(item)
        const id = stringValue(entry.id)
        const name = stringValue(entry.name) || stringValue(entry.path) || id
        const rawType = stringValue(entry.type)
        if (!id || !name) return null
        return {
            id,
            name,
            alias: stringValue(entry.alias) || null,
            parent: stringValue(entry.parent) || null,
            type: rawType === 'folder' ? 'folder' : 'file',
            children: normalizeShareTree(entry.children),
        }
    }).filter(Boolean) as ShareTreeItem[]
}

function normalizeMailAddresses(value: unknown): MailAddress[] {
    if (!Array.isArray(value)) return []
    return value.map(item => {
        const entry = asRecord(item)
        const email = stringValue(entry.email)
        if (!email) return null
        return { email, name: stringValue(entry.name) || undefined }
    }).filter(Boolean) as MailAddress[]
}

function normalizeMailbox(value: unknown): MailboxItem | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    const name = stringValue(entry.name)
    if (!id || !name) return null
    return {
        id,
        name,
        role: stringValue(entry.role) || undefined,
        unreadEmails: numberValue(entry.unreadEmails) ?? numberValue(entry.unread_emails),
    }
}

function normalizeMailSummary(value: unknown): MailMessageSummary | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null
    return {
        id,
        subject: stringValue(entry.subject) || '(no subject)',
        preview: stringValue(entry.preview),
        receivedAt: stringValue(entry.receivedAt) || stringValue(entry.received_at),
        from: normalizeMailAddresses(entry.from),
        to: normalizeMailAddresses(entry.to),
        hasAttachment: booleanValue(entry.hasAttachment) ?? booleanValue(entry.has_attachment) ?? false,
        isRead: booleanValue(entry.isRead) ?? booleanValue(entry.is_read) ?? false,
        isFlagged: booleanValue(entry.isFlagged) ?? booleanValue(entry.is_flagged) ?? false,
    }
}

function normalizeMailMessage(value: unknown): MailMessage | null {
    const summary = normalizeMailSummary(value)
    if (!summary) return null
    const entry = asRecord(value)
    return {
        ...summary,
        textBody: stringValue(entry.textBody) || stringValue(entry.text_body) || summary.preview,
        htmlBody: stringValue(entry.htmlBody) || stringValue(entry.html_body),
    }
}

function normalizeMailOverview(value: unknown): MailOverview {
    const entry = asRecord(value)
    const messages = Array.isArray(entry.messages)
        ? entry.messages.map(normalizeMailSummary).filter(Boolean) as MailMessageSummary[]
        : []
    return {
        mailboxUser: stringValue(entry.mailboxUser) || stringValue(entry.mailbox_user),
        mailboxAddress: stringValue(entry.mailboxAddress) || stringValue(entry.mailbox_address) || 'Not connected',
        accessibleAccounts: Array.isArray(entry.accessibleAccounts)
            ? entry.accessibleAccounts.map(item => {
                const account = asRecord(item)
                const id = stringValue(account.id)
                if (!id) return null
                return {
                    id,
                    name: stringValue(account.name) || id,
                    address: stringValue(account.address),
                }
            }).filter(Boolean) as Array<{ id: string; name: string; address: string }>
            : [],
        mailboxes: Array.isArray(entry.mailboxes) ? entry.mailboxes.map(normalizeMailbox).filter(Boolean) as MailboxItem[] : [],
        selectedMailboxId: stringValue(entry.selectedMailboxId) || stringValue(entry.selected_mailbox_id) || null,
        messages,
        selectedMessage: normalizeMailMessage(entry.selectedMessage || entry.selected_message),
    }
}

function normalizeMailSendResult(value: unknown): MailSendResult | null {
    const entry = asRecord(value)
    if (!Object.keys(entry).length) return null
    return {
        ok: booleanValue(entry.ok) ?? false,
        mailboxUser: stringValue(entry.mailboxUser) || stringValue(entry.mailbox_user),
        sentMailboxId: stringValue(entry.sentMailboxId) || stringValue(entry.sent_mailbox_id) || null,
        sentMessageId: stringValue(entry.sentMessageId) || stringValue(entry.sent_message_id) || null,
    }
}

function normalizeGptClient(value: unknown): GptClient | null {
    const entry = asRecord(value)
    const name = stringValue(entry.name)
    if (!name) return null
    const model = asRecord(entry.model)
    return {
        name,
        model: {
            tps: numberValue(model.tps),
            status: stringValue(model.status) || undefined,
        },
    }
}

function normalizeTrafficDomain(value: unknown): { name: string; tps?: number } | null {
    const entry = asRecord(value)
    const name = stringValue(entry.name) || stringValue(entry.domain)
    if (!name) return null
    return { name, tps: numberValue(entry.tps) }
}

function normalizeDesktopStatus(value: unknown): DesktopAgentStatus {
    const entry = asRecord(value)
    return {
        ok: booleanValue(entry.ok) ?? false,
        agent: stringValue(entry.agent) || undefined,
        hostname: stringValue(entry.hostname) || undefined,
        platform: stringValue(entry.platform) || undefined,
        user: stringValue(entry.user) || undefined,
        cwd: stringValue(entry.cwd) || undefined,
        uptimeSeconds: numberValue(entry.uptimeSeconds) ?? numberValue(entry.uptime_seconds),
        timestamp: stringValue(entry.timestamp) || undefined,
        message: stringValue(entry.message) || undefined,
        screenCaptureAllowed: booleanValue(entry.screenCaptureAllowed) ?? booleanValue(entry.screen_capture_allowed),
        accessibilityAllowed: booleanValue(entry.accessibilityAllowed) ?? booleanValue(entry.accessibility_allowed),
    }
}

function normalizeNote(value: unknown): Note | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null
    return {
        id,
        title: stringValue(entry.title),
        content: stringValue(entry.content),
        source: stringValue(entry.source) || 'app',
        owner_id: stringValue(entry.owner_id) || stringValue(entry.ownerId),
        created_at: stringValue(entry.created_at) || stringValue(entry.createdAt),
        updated_at: stringValue(entry.updated_at) || stringValue(entry.updatedAt),
    }
}

function normalizeRole(value: unknown): DashboardRole | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id) || stringValue(entry.role_id) || stringValue(entry.name)
    if (!id) return null
    return {
        id,
        name: stringValue(entry.name) || id,
        description: stringValue(entry.description) || undefined,
        priority: numberValue(entry.priority),
    }
}

function normalizeUserRoleAssignment(value: unknown): DashboardUserRoleAssignment | null {
    const entry = asRecord(value)
    const roleId = stringValue(entry.role_id) || stringValue(entry.roleId) || stringValue(entry.id) || stringValue(entry.name)
    if (!roleId) return null
    return {
        id: stringValue(entry.id) || roleId,
        roleId,
        name: stringValue(entry.name) || roleId,
        priority: numberValue(entry.priority),
    }
}

function normalizeDashboardUser(value: unknown): DashboardUser | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null
    const roles = Array.isArray(entry.roles) ? entry.roles.map(normalizeRole).filter(Boolean) as DashboardRole[] : undefined
    return {
        id,
        name: stringValue(entry.name) || stringValue(entry.displayName) || stringValue(entry.display_name) || id,
        active: booleanValue(entry.active),
        role: stringValue(entry.role) || stringValue(entry.role_id) || roles?.[0]?.name,
        roles,
        highestRolePriority: numberValue(entry.highestRolePriority) ?? numberValue(entry.highest_role_priority),
    }
}

async function readJsonObject(response: Response, fallback: unknown) {
    return response.json().catch(() => fallback)
}

export async function fetchMailOverview(settings: AppSettings, mailboxId?: string | null, messageId?: string | null, mailboxUser?: string | null) {
    requireAppAuth(settings, 'load mail')

    const search = new URLSearchParams()
    if (mailboxUser) search.set('mailboxUser', mailboxUser)
    if (mailboxId) search.set('mailboxId', mailboxId)
    if (messageId) search.set('messageId', messageId)

    const response = await fetch(`${joinUrl(settings.apiBaseUrl, 'mail/overview')}?${search.toString()}`, {
        headers: headers(settings),
    })

    if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Unable to load mail overview.')
    }

    const body = await response.json().catch(() => null)
    if (!body || typeof body !== 'object') {
        throw new Error('Mail overview returned an unexpected response.')
    }

    return normalizeMailOverview(body)
}

export async function postMailAction(settings: AppSettings, messageId: string, action: string, targetMailboxId?: string) {
    requireAppAuth(settings, 'update mail')

    const response = await fetch(joinUrl(settings.apiBaseUrl, `mail/message/${segment(messageId)}/action`), {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({ action, targetMailboxId }),
    })

    if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Unable to update message.')
    }
}

export async function createMailbox(settings: AppSettings, name: string) {
    requireAppAuth(settings, 'create mailbox folders')

    const response = await fetch(joinUrl(settings.apiBaseUrl, 'mail/mailboxes'), {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({ name }),
    })

    if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Unable to create mailbox.')
    }
}

export async function sendMailMessage(settings: AppSettings, body: {
    mailboxUser?: string
    to: string
    cc?: string
    bcc?: string
    subject: string
    textBody: string
}) {
    requireAppAuth(settings, 'send mail')

    const response = await fetch(joinUrl(settings.apiBaseUrl, 'mail/send'), {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify(body),
    })

    const responseBody = await response.json().catch(() => null)
    if (!response.ok) {
        throw new Error(String((responseBody as { error?: string } | null)?.error || 'Unable to send mail.'))
    }

    return normalizeMailSendResult(responseBody)
}

export async function triggerServerAction(url: string, settings?: AppSettings) {
    assertSecureTransport(url)
    const response = await fetch(url, {
        method: 'POST',
        headers: settings ? headers(settings) : undefined,
    })

    if (!response.ok) {
        throw new Error(`Action failed with status ${response.status}`)
    }

    return response.text().catch(() => 'Done')
}

export async function fetchServerText(url: string, settings?: AppSettings) {
    assertSecureTransport(url)
    const response = await fetch(url, {
        headers: settings ? headers(settings) : undefined,
    })

    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`)
    }

    return response.text().catch(() => '')
}

export async function askCodex(settings: AppSettings, prompt: string, context?: string): Promise<AiRunDetails> {
    requireAppAuth(settings, 'use Codex in-app')

    const response = await fetch(joinUrl(settings.apiBaseUrl, settings.codexApiPath), {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({ prompt, context }),
    })

    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to reach the Codex tool endpoint.'))
    }

    return {
        message: String(body.message || body.suggestion || body.error || 'No response.'),
        durationMs: numberValue(body.durationMs) ?? numberValue(body.duration_ms) ?? numberValue(body.elapsedMs),
        thoughtSummary: stringValue(body.thoughtSummary) || stringValue(body.summary) || stringValue(body.thoughts) || undefined,
        toolUses: normalizeToolUses(body.toolUses || body.tools || body.tool_calls),
        fileSummaries: normalizeFileSummaries(body.fileSummaries || body.files || body.changedFiles),
    }
}

export async function fetchAiModels(settings: AppSettings) {
    if (!settings.apiBaseUrl.trim()) {
        return []
    }

    const response = await fetch(joinUrl(settings.apiBaseUrl, 'ai/models'), {
        headers: headers(settings),
    })
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to load model status.'))
    }

    const connected = Array.isArray(body.connected) ? body.connected.map(normalizeGptClient).filter(Boolean) as GptClient[] : []
    return connected
}

export async function fetchUserShares(settings: AppSettings) {
    requireCdnAuth(settings, 'load shares')

    const response = await fetch(joinUrl(settings.cdnBaseUrl, `share/user/${segment(settings.userId)}`), {
        headers: headers(settings),
    })
    const body = await response.json().catch(() => ([]))
    if (!response.ok) {
        throw new Error('Unable to load shares.')
    }

    return Array.isArray(body) ? body.map(normalizeShare).filter(Boolean) as ShareSummary[] : []
}

export async function createShare(settings: AppSettings, payload: { id: string; content: string; name?: string; path?: string; type?: string }) {
    requireCdnAuth(settings, 'create shares')

    const response = await fetch(joinUrl(settings.cdnBaseUrl, 'share'), {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify(payload),
    })
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to create share.'))
    }

    const share = normalizeShare(body)
    if (!share) {
        throw new Error('Create share returned an unexpected response.')
    }
    return share
}

export async function updateShare(settings: AppSettings, id: string, updates: { path?: string; content?: string; name?: string }) {
    requireCdnAuth(settings, 'update shares')

    const response = await fetch(joinUrl(settings.cdnBaseUrl, `share/${segment(id)}`), {
        method: 'PUT',
        headers: headers(settings),
        body: JSON.stringify(updates),
    })
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to update share.'))
    }

    const share = normalizeShare(body)
    if (!share) {
        throw new Error('Update share returned an unexpected response.')
    }
    return share
}

export async function deleteShare(settings: AppSettings, id: string) {
    requireCdnAuth(settings, 'delete shares')

    const response = await fetch(joinUrl(settings.cdnBaseUrl, `share/${segment(id)}`), {
        method: 'DELETE',
        headers: headers(settings),
    })
    if (!response.ok) {
        const body = await response.json().catch(() => ({} as Record<string, unknown>))
        throw new Error(String(body.error || 'Unable to delete share.'))
    }
}

export async function setShareLock(settings: AppSettings, id: string, locked: boolean) {
    requireCdnAuth(settings, 'lock shares')

    const response = await fetch(joinUrl(settings.cdnBaseUrl, `share/lock/${segment(id)}`), {
        method: 'PUT',
        headers: headers(settings),
        body: JSON.stringify({ locked }),
    })
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to lock or unlock share.'))
    }

    const share = normalizeShare(body)
    if (!share) {
        throw new Error('Lock share returned an unexpected response.')
    }
    return share
}

export async function fetchShareTree(settings: AppSettings, id: string) {
    requireCdnAuth(settings, 'load share trees')

    const response = await fetch(joinUrl(settings.cdnBaseUrl, `share/tree/${segment(id)}`), {
        headers: headers(settings),
    })
    const body = await response.json().catch(() => [])
    if (!response.ok) {
        throw new Error('Unable to load share tree.')
    }

    return normalizeShareTree(body)
}

export async function fetchTopDomains(settings: AppSettings) {
    if (!settings.cdnBaseUrl.trim()) {
        return []
    }

    const response = await fetch(`${joinUrl(settings.cdnBaseUrl, 'traffic/tps')}?fresh=1`, {
        headers: headers(settings),
    })
    const body = await response.json().catch(() => ([]))
    if (!response.ok) {
        throw new Error('Unable to load domain activity.')
    }

    return Array.isArray(body) ? body.map(normalizeTrafficDomain).filter(Boolean).slice(0, 5) as Array<{ name: string; tps?: number }> : []
}

export async function fetchDesktopAgentStatus(settings: AppSettings) {
    const response = await fetchDesktopAgentPath(settings, 'status')
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(String(asRecord(body).message || 'Desktop agent did not return a healthy status.'))
    }

    return normalizeDesktopStatus(body)
}

export async function runDesktopAgentCommand(settings: AppSettings, command: string) {
    const response = await fetchDesktopAgentPath(settings, 'command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(String(asRecord(body).message || 'Desktop command failed.'))
    }

    return normalizeDesktopStatus(body)
}

export async function fetchDesktopScreenshot(settings: AppSettings) {
    const response = await fetchDesktopAgentPath(settings, 'screenshot')
    const body = asRecord(await response.json().catch(() => ({})))
    if (!response.ok || !booleanValue(body.ok)) {
        throw new Error(String(body.message || 'Unable to capture Mac screen.'))
    }

    const mimeType = stringValue(body.mimeType) || 'image/png'
    const imageBase64 = stringValue(body.imageBase64)
    if (!imageBase64) {
        throw new Error('Desktop screenshot response did not include an image.')
    }

    return {
        ok: true,
        message: stringValue(body.message) || undefined,
        mimeType,
        imageBase64,
    }
}

export async function fetchNotes(settings: AppSettings) {
    requireAppAuth(settings, 'load notes')

    const response = await fetch(joinUrl(settings.apiBaseUrl, 'notes'), {
        headers: headers(settings),
    })
    const body = await response.json().catch(() => ([]))
    if (!response.ok) {
        throw new Error(String((body as { error?: string }).error || 'Unable to load notes.'))
    }

    return Array.isArray(body) ? body.map(normalizeNote).filter(Boolean) as Note[] : []
}

export async function createNote(settings: AppSettings, payload: { title: string; content: string }) {
    requireAppAuth(settings, 'save notes')

    const response = await fetch(joinUrl(settings.apiBaseUrl, 'notes'), {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({ ...payload, source: 'app' }),
    })
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to create note.'))
    }

    const note = normalizeNote(body)
    if (!note) {
        throw new Error('Create note returned an unexpected response.')
    }
    return note
}

export async function updateNote(settings: AppSettings, id: string, payload: { title: string; content: string }) {
    requireAppAuth(settings, 'save notes')

    const response = await fetch(joinUrl(settings.apiBaseUrl, `notes/${segment(id)}`), {
        method: 'PUT',
        headers: headers(settings),
        body: JSON.stringify({ ...payload, source: 'app' }),
    })
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to update note.'))
    }

    const note = normalizeNote(body)
    if (!note) {
        throw new Error('Update note returned an unexpected response.')
    }
    return note
}

export async function deleteNote(settings: AppSettings, id: string) {
    requireAppAuth(settings, 'delete notes')

    const response = await fetch(joinUrl(settings.apiBaseUrl, `notes/${segment(id)}`), {
        method: 'DELETE',
        headers: headers(settings),
    })
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok) {
        throw new Error(String(body.error || 'Unable to delete note.'))
    }
}

export async function fetchDashboardUsers(settings: AppSettings) {
    requireAppAuth(settings, 'load users')

    const response = await fetch(joinUrl(settings.apiBaseUrl, 'users'), {
        headers: headers(settings),
    })
    const body = await readJsonObject(response, [])
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to load users.'))
    }

    return Array.isArray(body) ? body.map(normalizeDashboardUser).filter(Boolean) as DashboardUser[] : []
}

export async function fetchDashboardRoles(settings: AppSettings) {
    requireAppAuth(settings, 'load roles')

    const response = await fetch(joinUrl(settings.apiBaseUrl, 'roles'), {
        headers: headers(settings),
    })
    const body = await readJsonObject(response, [])
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to load roles.'))
    }

    return Array.isArray(body) ? body.map(normalizeRole).filter(Boolean) as DashboardRole[] : []
}

export async function fetchDashboardUserRoles(settings: AppSettings, userId: string) {
    requireAppAuth(settings, 'load user roles')

    const response = await fetch(joinUrl(settings.apiBaseUrl, `roles/user/${segment(userId)}`), {
        headers: headers(settings),
    })
    const body = await readJsonObject(response, [])
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to load user roles.'))
    }

    return Array.isArray(body) ? body.map(normalizeUserRoleAssignment).filter(Boolean) as DashboardUserRoleAssignment[] : []
}

export async function startMobileImpersonation(settings: AppSettings, userId: string) {
    requireAppAuth(settings, 'impersonate users')
    if (userId === settings.userId) {
        throw new Error('You are already viewing your own account.')
    }

    const response = await fetch(joinUrl(settings.apiBaseUrl, 'impersonation/start'), {
        method: 'POST',
        headers: headers({ ...settings, impersonationToken: '', impersonatingUserId: '', impersonatingUserName: '' }),
        body: JSON.stringify({ target_id: userId }),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to start impersonation.'))
    }
    const record = asRecord(body)
    const session = asRecord(record.session)
    const target = asRecord(session.target)
    return {
        token: String(record.token || ''),
        targetId: String(target.id || userId),
        targetName: String(target.name || userId),
    }
}

export async function stopMobileImpersonation(settings: AppSettings) {
    if (!settings.impersonationToken || !settings.authToken || !settings.userId) return
    await fetch(joinUrl(settings.apiBaseUrl, 'impersonation'), {
        method: 'DELETE',
        headers: headers(settings),
    }).catch(() => {})
}

export async function setDashboardUserActive(settings: AppSettings, userId: string, active: boolean) {
    requireAppAuth(settings, 'update users')

    const response = await fetch(joinUrl(settings.apiBaseUrl, `user/${segment(userId)}/active`), {
        method: 'PUT',
        headers: headers(settings),
        body: JSON.stringify({ active }),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to update user.'))
    }
}

export async function assignDashboardUserRole(settings: AppSettings, userId: string, roleId: string) {
    return mutateDashboardUserRole(settings, userId, roleId, true)
}

export async function unassignDashboardUserRole(settings: AppSettings, userId: string, roleId: string) {
    return mutateDashboardUserRole(settings, userId, roleId, false)
}

async function mutateDashboardUserRole(settings: AppSettings, userId: string, roleId: string, assigned: boolean) {
    requireAppAuth(settings, assigned ? 'assign roles' : 'remove roles')

    const action = assigned ? 'assign' : 'unassign'
    const response = await fetch(joinUrl(settings.apiBaseUrl, `role/${action}/${segment(userId)}`), {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({ role_id: roleId }),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || `Unable to ${action} role.`))
    }

    return body
}

export async function fetchAutomations(settings: AppSettings) {
    requireAppAuth(settings, 'load automations')

    const response = await fetch(joinUrl(settings.apiBaseUrl, 'automations'), {
        headers: headers(settings),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to load automations.'))
    }

    const automations = asRecord(body).automations
    return Array.isArray(automations) ? automations.map(normalizeAutomation).filter(Boolean) as AgentAutomation[] : []
}

export async function fetchAutomationDetails(settings: AppSettings, id: string) {
    requireAppAuth(settings, 'load automation runs')

    const response = await fetch(joinUrl(settings.apiBaseUrl, `automations/${segment(id)}`), {
        headers: headers(settings),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to load automation.'))
    }

    const entry = asRecord(body)
    const automation = normalizeAutomation(entry.automation)
    const runs = Array.isArray(entry.runs) ? entry.runs.map(normalizeAutomationRun).filter(Boolean) as AgentAutomationRun[] : []
    return { automation, runs }
}

export async function createAutomation(settings: AppSettings, payload: AgentAutomationPayload) {
    return mutateAutomation(settings, 'automations', 'POST', payload)
}

export async function updateAutomation(settings: AppSettings, id: string, payload: AgentAutomationPayload) {
    return mutateAutomation(settings, `automations/${segment(id)}`, 'PUT', payload)
}

export async function deleteAutomation(settings: AppSettings, id: string) {
    return mutateAutomation(settings, `automations/${segment(id)}`, 'DELETE')
}

export async function runAutomationNow(settings: AppSettings, id: string) {
    requireAppAuth(settings, 'run automations')

    const response = await fetch(joinUrl(settings.apiBaseUrl, `automations/${segment(id)}/run`), {
        method: 'POST',
        headers: headers(settings),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to run automation.'))
    }
}

export async function fetchManagedCronJobs(settings: AppSettings) {
    requireAppAuth(settings, 'load system cron jobs')

    const response = await fetch(joinUrl(settings.apiBaseUrl, 'system/cron'), {
        headers: headers(settings),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to load cron jobs.'))
    }

    const jobs = asRecord(body).jobs
    return Array.isArray(jobs) ? jobs.map(normalizeManagedCronJob).filter(Boolean) as ManagedCronJob[] : []
}

export async function updateManagedCronJob(settings: AppSettings, id: string, payload: { schedule?: string, enabled?: boolean }) {
    requireAppAuth(settings, 'update system cron jobs')

    const response = await fetch(joinUrl(settings.apiBaseUrl, `system/cron/${segment(id)}`), {
        method: 'PUT',
        headers: headers(settings),
        body: JSON.stringify(payload),
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to update cron job.'))
    }

    const jobs = asRecord(body).jobs
    return Array.isArray(jobs) ? jobs.map(normalizeManagedCronJob).filter(Boolean) as ManagedCronJob[] : []
}

async function mutateAutomation(settings: AppSettings, path: string, method: 'POST' | 'PUT' | 'DELETE', payload?: AgentAutomationPayload) {
    requireAppAuth(settings, 'save automations')

    const response = await fetch(joinUrl(settings.apiBaseUrl, path), {
        method,
        headers: headers(settings),
        body: payload ? JSON.stringify(payload) : undefined,
    })
    const body = await readJsonObject(response, {})
    if (!response.ok) {
        throw new Error(String(asRecord(body).error || 'Unable to save automation.'))
    }

    return normalizeAutomation(asRecord(body).automation)
}

function normalizeAutomation(value: unknown): AgentAutomation | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null

    return {
        id,
        name: stringValue(entry.name) || 'Automation',
        prompt: stringValue(entry.prompt),
        scheduleKind: stringValue(entry.scheduleKind) === 'once' ? 'once' : 'interval',
        intervalMinutes: typeof entry.intervalMinutes === 'number' ? entry.intervalMinutes : null,
        runAt: stringValue(entry.runAt) || null,
        status: stringValue(entry.status) === 'paused' ? 'paused' : stringValue(entry.status) === 'archived' ? 'archived' : 'active',
        actionType: stringValue(entry.actionType) === 'echo' ? 'echo' : 'agent_prompt',
        timezone: stringValue(entry.timezone) || 'UTC',
        modelName: stringValue(entry.modelName) || null,
        notifyOn: stringValue(entry.notifyOn) === 'always' ? 'always' : stringValue(entry.notifyOn) === 'never' ? 'never' : 'failure',
        nextRunAt: stringValue(entry.nextRunAt) || null,
        lastRunAt: stringValue(entry.lastRunAt) || null,
        lastCompletedAt: stringValue(entry.lastCompletedAt) || null,
        lastStatus: stringValue(entry.lastStatus) || null,
        lastResult: stringValue(entry.lastResult) || null,
        lastError: stringValue(entry.lastError) || null,
        consecutiveFailures: Number(entry.consecutiveFailures) || 0,
        pausedReason: stringValue(entry.pausedReason) || null,
        runCount: Number(entry.runCount) || 0,
        createdAt: stringValue(entry.createdAt),
        updatedAt: stringValue(entry.updatedAt),
    }
}

function normalizeAutomationRun(value: unknown): AgentAutomationRun | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null

    return {
        id,
        automationId: stringValue(entry.automationId),
        status: stringValue(entry.status) === 'failed' ? 'failed' : stringValue(entry.status) === 'completed' ? 'completed' : 'running',
        result: stringValue(entry.result) || null,
        error: stringValue(entry.error) || null,
        provider: stringValue(entry.provider) || null,
        model: stringValue(entry.model) || null,
        startedAt: stringValue(entry.startedAt),
        completedAt: stringValue(entry.completedAt) || null,
        durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : null,
    }
}

function normalizeManagedCronJob(value: unknown): ManagedCronJob | null {
    const entry = asRecord(value)
    const id = stringValue(entry.id)
    if (!id) return null

    return {
        id,
        name: stringValue(entry.name) || id,
        description: stringValue(entry.description),
        defaultSchedule: stringValue(entry.defaultSchedule),
        command: stringValue(entry.command),
        host: stringValue(entry.host),
        logPath: stringValue(entry.logPath) || undefined,
        schedule: stringValue(entry.schedule),
        enabled: booleanValue(entry.enabled) ?? false,
        installed: booleanValue(entry.installed) ?? false,
        lastLogLine: stringValue(entry.lastLogLine) || null,
        lastLogAt: stringValue(entry.lastLogAt) || null,
    }
}
