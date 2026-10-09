export type RouteShortcut = {
    title: string
    path: string
    summary: string
    category: string
}

export type RootTabParamList = {
    Home: undefined
    Profile: undefined
    Mail: undefined
    Scan: undefined
    Notes: undefined
    Images: undefined
    Automations: undefined
    Control: undefined
}

export type AppSettings = {
    themeMode: 'obsidian' | 'graphite' | 'forest'
    workspaceMode: 'coding' | 'daily'
    siteBaseUrl: string
    apiBaseUrl: string
    cdnBaseUrl: string
    authToken: string
    userId: string
    impersonationToken: string
    impersonatingUserId: string
    impersonatingUserName: string
    codexUrl: string
    codexApiPath: string
    desktopAgentBaseUrl: string
    vpnUrlScheme: string
    remoteDesktopHost: string
    remoteDesktopUser: string
    vncHost: string
    serverBaseUrl: string
    serverStartPath: string
    serverStopPath: string
    serverLogsPath: string
}

export type HanasandAuthSession = {
    id: string
    name?: string
    avatar?: string | null
    roles?: string[]
    token: string
    expiresAt?: string
}

export type MailAddress = {
    email: string
    name?: string
}

export type MailMessageSummary = {
    id: string
    subject: string
    preview: string
    receivedAt: string
    from: MailAddress[]
    to: MailAddress[]
    hasAttachment: boolean
    isRead: boolean
    isFlagged: boolean
}

export type MailMessage = MailMessageSummary & {
    textBody: string
    htmlBody: string
}

export type MailboxItem = {
    id: string
    name: string
    role?: string
    unreadEmails?: number
}

export type MailOverview = {
    mailboxUser: string
    mailboxAddress: string
    accessibleAccounts: Array<{ id: string; name: string; address: string }>
    mailboxes: MailboxItem[]
    selectedMailboxId: string | null
    messages: MailMessageSummary[]
    selectedMessage: MailMessage | null
}

export type MailSendResult = {
    ok: boolean
    mailboxUser: string
    sentMailboxId: string | null
    sentMessageId: string | null
}

export type ScannerPage = {
    id: string
    uri: string
    createdAt: number
}

export type SwipeDecision = 'keep' | 'discard'

export type ImageReviewAsset = {
    id: string
    uri: string
    filename?: string
    width: number
    height: number
    creationTime?: number
}

export type SavedMailboxConnection = {
    id: string
    label: string
    email: string
    imapHost: string
    smtpHost: string
}

export type AiChatMessage = {
    id: string
    role: 'user' | 'assistant'
    content: string
    createdAt: number
    error?: boolean
    pending?: boolean
    durationMs?: number
    thoughtSummary?: string
    toolUses?: AiToolUseSummary[]
    fileSummaries?: AiFileSummary[]
}

export type AiToolUseSummary = {
    name: string
    summary?: string
    durationMs?: number
}

export type AiFileSummary = {
    path: string
    summary?: string
    additions?: number
    deletions?: number
}

export type AiRunDetails = {
    message: string
    durationMs?: number
    thoughtSummary?: string
    toolUses?: AiToolUseSummary[]
    fileSummaries?: AiFileSummary[]
}

export type AuthenticatorEntry = {
    id: string
    label: string
    issuer?: string
    account?: string
    secret: string
    digits: number
    period: number
}

export type GptClient = {
    name: string
    model?: {
        tps?: number
        status?: string
    }
}

export type ShareSummary = {
    id: string
    alias?: string | null
    path?: string | null
    name?: string | null
    timestamp?: string
    content?: string
    locked?: boolean
    parent?: string | null
    type?: string | null
}

export type ShareTreeItem = {
    id: string
    name: string
    alias?: string | null
    parent?: string | null
    type: 'file' | 'folder'
    children?: ShareTreeItem[]
}

export type Note = {
    id: string
    title: string
    content: string
    source: string
    owner_id: string
    created_at: string
    updated_at: string
}

export type DashboardRole = {
    id: string
    name?: string
    description?: string
    priority?: number
}

export type DashboardUserRoleAssignment = {
    id: string
    roleId: string
    name?: string
    priority?: number
}

export type DashboardUser = {
    id: string
    name?: string
    active?: boolean
    role?: string
    roles?: DashboardRole[]
    highestRolePriority?: number
}

export type DesktopAgentStatus = {
    ok: boolean
    agent?: string
    hostname?: string
    platform?: string
    user?: string
    cwd?: string
    uptimeSeconds?: number
    timestamp?: string
    message?: string
    screenCaptureAllowed?: boolean
    accessibilityAllowed?: boolean
}

export type DesktopAgentPresence = {
    deviceId: string
    deviceName?: string
    endpoints: string[]
    updatedAt?: string
    expiresAt?: string
}

export type DesktopScreenshot = {
    ok: boolean
    message?: string
    mimeType?: string
    imageBase64?: string
}

export type AgentAutomation = {
    id: string
    name: string
    prompt: string
    scheduleKind: 'once' | 'interval'
    intervalMinutes: number | null
    runAt: string | null
    status: 'active' | 'paused' | 'archived'
    actionType: 'agent_prompt' | 'echo'
    timezone: string
    modelName: string | null
    notifyOn: 'never' | 'failure' | 'always'
    nextRunAt: string | null
    lastRunAt: string | null
    lastCompletedAt: string | null
    lastStatus: string | null
    lastResult: string | null
    lastError: string | null
    consecutiveFailures: number
    pausedReason: string | null
    runCount: number
    createdAt: string
    updatedAt: string
}

export type AgentAutomationRun = {
    id: string
    automationId: string
    status: 'running' | 'completed' | 'failed'
    result: string | null
    error: string | null
    provider: string | null
    model: string | null
    startedAt: string
    completedAt: string | null
    durationMs: number | null
}

export type AgentAutomationPayload = {
    name: string
    prompt: string
    scheduleKind: 'once' | 'interval'
    intervalMinutes?: number | null
    runAt?: string | null
    status: 'active' | 'paused'
    actionType: 'agent_prompt' | 'echo'
    timezone?: string
    modelName?: string | null
    notifyOn?: 'never' | 'failure' | 'always'
}

export type ManagedCronJob = {
    id: string
    name: string
    description: string
    defaultSchedule: string
    command: string
    host: string
    logPath?: string
    schedule: string
    enabled: boolean
    installed: boolean
    lastLogLine: string | null
    lastLogAt: string | null
}
