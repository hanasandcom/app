import { Linking, View } from 'react-native'
import { GlassCard, InlineNotice, PillButton } from '../../components/ui'
import { Actions, CaseInput, CaseText, Options } from './ui'
import { own, text, type Repository, type Row } from './model'
import type { CaseController } from './controller'
import type { AppSettings } from '../../types'
export type DevelopmentPage = { items: Row[]; hasMore: boolean; offset: number }
export type CommitPage = { items: Row[]; nextCursor?: string }
export function Development({ settings, ops, host, repositories, repositoryError, developmentError, page, canConnect, draft, setDraft, commits, cursor, previous, selected, select, loadCommits, developmentPage, connect, disconnect, link, secret, hideSecret }: {
    settings: AppSettings; ops: CaseController; host: number; repositories: Repository[] | null; repositoryError: string; developmentError: string; page: DevelopmentPage | null; canConnect: boolean
    draft: { provider: string; url: string; search: string }; setDraft: (v: Partial<{ provider: string; url: string; search: string }>) => void
    commits: CommitPage | null; cursor?: string; previous: () => void; selected: string; select: (v: string) => void
    loadCommits: (next?: string) => void; developmentPage: (offset: number) => void
    connect: () => void; disconnect: (v: Repository) => void; link: (commit: string) => void
    secret: { secret: string; webhookUrl: string } | null; hideSecret: () => void
}) {
    const writable = own(settings) && ops.idle(host) && !ops.locked
    return <View style={{ gap: 12 }}>

        <GlassCard>
            <View style={{ gap: 10 }}>
                <CaseText heading>Development history</CaseText>
                {!!developmentError && <InlineNotice message={developmentError} />}

                {page?.items.map((entry, i) => <View key={`${text(entry.repository_id)}:${text(entry.kind)}:${text(entry.external_id)}:${i}`} style={{ gap: 4 }}>
                    <CaseText heading>{text(entry.kind)} · {text(entry.title)}</CaseText>
                    <CaseText>{text(entry.external_id)}{ '\n' }{text(entry.provider)} · {text(entry.repository_url)}{ '\n' }{text(entry.state)} · {text(entry.author)} · {text(entry.updated_at)}{ '\n' }{text(entry.branch)}</CaseText>
                    <PillButton
                        label='Open change on repository website'
                        onPress={() => { if (!ops.idle(host)) return; try { const u = new URL(text(entry.url)); if (u.protocol === 'https:' && !u.username && !u.password) void Linking.openURL(u.href).catch(() => {}) } catch { /* Invalid external links are not opened. */ } }}
                    />
                </View>)}

                {page && !page.items.length && <CaseText>No linked development changes on this page.</CaseText>}

                <Actions>
                    <PillButton
                        label='Previous changes'
                        disabled={!ops.idle(host) || !page?.offset}
                        onPress={() => developmentPage(Math.max(0, (page?.offset || 0) - 50))}
                    />
                    <PillButton
                        label='Next changes'
                        disabled={!ops.idle(host) || !page?.hasMore}
                        onPress={() => developmentPage((page?.offset || 0) + 50)}
                    />
                </Actions>

            </View>
        </GlassCard>

        <GlassCard>
            <View style={{ gap: 10 }}>
                <CaseText heading>Link a commit</CaseText>

                <CaseText>Choose a repository, search its available commit history, then confirm the commit to link to this case.</CaseText>

                {(repositories || []).map(r => <PillButton
                    key={r.id}
                    label={`${selected === r.id ? '✓ ' : ''}${r.url}`}
                    disabled={!ops.idle(host)}
                    onPress={() => select(r.id)}
                />)}

                <CaseInput
                    label='Search commit title, author or hash'
                    value={draft.search}
                    onChange={search => setDraft({ search })}
                    ops={ops}
                    host={host}
                    limit={200}
                />

                <PillButton label='Search commits' disabled={!ops.idle(host) || !selected || !repositories} onPress={() => loadCommits()} />

                {commits?.items.map(v => <View key={text(v.external_id)}>
                    <CaseText heading>{text(v.title)}</CaseText>
                    <CaseText>{text(v.author)} · {text(v.updated_at)}{ '\n' }{text(v.external_id)}</CaseText>
                    <PillButton
                        label='Link this commit'
                        disabled={!writable || !repositories?.find(r => r.id === selected)?.canManage}
                        onPress={() => link(text(v.external_id))}
                    />
                </View>)}

                {commits && !commits.items.length && <CaseText>No commits match this search.</CaseText>}

                <Actions>
                    <PillButton label='Previous commits' disabled={!ops.idle(host) || !cursor} onPress={previous} />
                    <PillButton
                        label='Next commits'
                        disabled={!ops.idle(host) || !commits?.nextCursor}
                        onPress={() => loadCommits(commits?.nextCursor)}
                    />
                </Actions>

            </View>
        </GlassCard>

        <GlassCard>
            <View style={{ gap: 10 }}>
                <CaseText heading>Repository connections</CaseText>
                {!!repositoryError && <InlineNotice message={repositoryError} />}
                <CaseText>Organization connections are shared with active members. Personal connections remain private to your account.</CaseText>

                {(repositories || []).map(r => <View key={r.id} style={{ gap: 5 }}>
                    <CaseText heading>{r.provider} · {r.url}</CaseText>
                    <CaseText>{r.organizationId ? 'Organization connection' : 'Personal connection'}{ '\n' }{r.lastReceivedAt ? `Last event: ${r.lastReceivedAt}` : 'Waiting for the first webhook event.'}{r.warning ? `\n${r.warning}` : ''}</CaseText>
                    <PillButton label='Disconnect repository' disabled={!writable || !r.canManage} onPress={() => disconnect(r)} />
                </View>)}

                {repositories?.length === 0 && <CaseText>No accessible repository connections.</CaseText>}

                <Options
                    label='Provider'
                    values={['forgejo', 'github', 'gitlab']}
                    value={draft.provider}
                    disabled={!writable || !canConnect}
                    choose={provider => setDraft({ provider })}
                />

                <CaseInput
                    label='HTTPS repository page URL'
                    disabled={!writable || !canConnect}
                    value={draft.url}
                    onChange={url => setDraft({ url })}
                    ops={ops}
                    host={host}
                    limit={2000}
                />

                <PillButton label='Connect repository' disabled={!writable || !canConnect || !draft.url.trim()} onPress={connect} />

                {!canConnect && <CaseText>Connecting organization repositories requires current owner or administrator access.</CaseText>}

                {secret && <View style={{ gap: 8 }}>
                    <CaseText heading>Webhook setup — secret shown once</CaseText>
                    <CaseText>Add this webhook in your repository settings. Select JSON, push and pull request events (merge request events for GitLab). Keep TLS verification enabled.</CaseText>
                    <CaseText>Webhook URL: {secret.webhookUrl}{ '\n' }Secret: {secret.secret}</CaseText>
                    <CaseText>For GitLab use Secret token. For GitHub and Forgejo use Secret. Save it securely before leaving this view.</CaseText>
                    <PillButton label='Hide webhook secret' onPress={hideSecret} />
                </View>}

            </View>
        </GlassCard>

    </View>
}
