import { FindingsScreen } from './FindingsScreen'
import { UserManagementScreen } from './UserManagementScreen'
import { LoadTestsScreen } from './LoadTestsScreen'
import ThesisScreen from './ThesisScreen'
import { OrganizationPrivacyScreen } from './OrganizationPrivacyScreen'
import ArticlesScreen from './ArticlesScreen'
import ThoughtsScreen from './ThoughtsScreen'
import { SystemScreen } from './SystemScreen'
import { CasesScreen } from './CasesScreen'
import { RuleTuningScreen } from './RuleTuningScreen'
import { ApiReferenceScreen } from './ApiReferenceScreen'
import { SupportDeskScreen } from './SupportDeskScreen'
import { OrganizationDirectoryScreen } from './OrganizationDirectoryScreen'
import { DeliveryHistoryScreen } from './DeliveryHistoryScreen'
import { IntegrationsScreen } from './IntegrationsScreen'
import { AiMetricsScreen } from './AiMetricsScreen'
import type { WebsiteCaseRef } from '../lib/workspace-links'
import { TrafficMapScreen } from './TrafficMapScreen'
import { TrafficScreen } from './TrafficScreen'
import { RateLimitsScreen } from './RateLimitsScreen'
import { DatabaseScreen } from './DatabaseScreen'
import { BackupsScreen } from './BackupsScreen'
import type { AppSettings, RootTabParamList } from '../types'
import { ThreatSearchScreen } from './ThreatSearchScreen'
import { PasswordCheckScreen } from './PasswordCheckScreen'
import { SubscriptionScreen } from './SubscriptionScreen'
import { HostUpdatesScreen } from './HostUpdatesScreen'
import { HostsScreen } from './HostsScreen'
import { IntelligenceScreen } from './IntelligenceScreen'
import { RulesScreen } from './RulesScreen'
import { OrganizationApiKeysScreen } from './OrganizationApiKeysScreen'

export function NativeToolsScreen({ settings, tool, onManageSshKeys, onSelectOrganization, onConfigureDelivery, onOpenCase, onViewAiLogs, onOpenVms, onOpenHealthCheck, onOpenIntelligenceCases, onOpenActor, onOpenMonitoredActors, onOpenApiJson, onOpenGuide, initialQuery, initialCaseId }: {
    settings: AppSettings; tool: RootTabParamList['Tools']['tool']; onManageSshKeys: () => void
    onSelectOrganization: (id: string) => void; onConfigureDelivery: () => void
    onOpenCase: (ref: WebsiteCaseRef) => void; onViewAiLogs: (containerName?: string) => void; onOpenVms: () => void
    onOpenHealthCheck: (id: string) => void; onOpenIntelligenceCases: () => void
    onOpenActor: (name: string) => void; onOpenMonitoredActors: (organizationId: string) => void
    onOpenApiJson: () => void; onOpenGuide: () => void; initialQuery?: string; initialCaseId?: string
}) {
    switch (tool) {
        case 'monitoring-cases': return <CasesScreen settings={settings} initialCaseId={initialCaseId} onOpenHealth={onOpenHealthCheck} onOpenIntelligence={onOpenIntelligenceCases} />
        case 'system-overview': return <SystemScreen settings={settings} mode='overview' onOpenLogs={onViewAiLogs} onOpenVms={onOpenVms} />
        case 'system-containers': return <SystemScreen settings={settings} mode='containers' onOpenLogs={onViewAiLogs} onOpenVms={onOpenVms} />
        case 'articles': return <ArticlesScreen settings={settings} />
        case 'thoughts': return <ThoughtsScreen settings={settings} />
        case 'organization-privacy': return <OrganizationPrivacyScreen settings={settings} />
        case 'thesis': return <ThesisScreen settings={settings} />
        case 'load-tests': return <LoadTestsScreen settings={settings} />
        case 'user-management': return <UserManagementScreen settings={settings} onSelectOrganization={onSelectOrganization} />
        case 'findings': return <FindingsScreen settings={settings} onOpenCase={ref => onOpenCase({ ...ref, route: 'alert_queue' })} onOpenActor={onOpenActor} onOpenMonitoredActors={onOpenMonitoredActors} />
        case 'rule-tuning': return <RuleTuningScreen settings={settings} />
        case 'api-reference': return <ApiReferenceScreen settings={settings} mode='reference' onOpenJson={onOpenApiJson} onOpenGuide={onOpenGuide} />
        case 'openapi-json': return <ApiReferenceScreen settings={settings} mode='json' onOpenJson={onOpenApiJson} onOpenGuide={onOpenGuide} />
        case 'support-desk': return <SupportDeskScreen settings={settings} />
        case 'organization-directory': return <OrganizationDirectoryScreen settings={settings} onSelectOrganization={onSelectOrganization} />
        case 'delivery-history': return <DeliveryHistoryScreen settings={settings} onConfigure={onConfigureDelivery} onOpenCase={onOpenCase} />
        case 'integrations': return <IntegrationsScreen settings={settings} />
        case 'ai-metrics': return <AiMetricsScreen settings={settings} onViewLogs={onViewAiLogs} />
        case 'traffic-map': return <TrafficMapScreen settings={settings} />
        case 'traffic-overview': return <TrafficScreen settings={settings} mode='overview' />
        case 'traffic-recent': return <TrafficScreen settings={settings} mode='recent' />
        case 'rate-limits': return <RateLimitsScreen settings={settings} />
        case 'database': return <DatabaseScreen settings={settings} />
        case 'backups': return <BackupsScreen settings={settings} />
        case 'threat-search': return <ThreatSearchScreen settings={settings} initialQuery={initialQuery} />
        case 'password-check': return <PasswordCheckScreen settings={settings} />
        case 'subscription': return <SubscriptionScreen settings={settings} />
        case 'host-updates': return <HostUpdatesScreen settings={settings} />
        case 'hosts': return <HostsScreen settings={settings} onManageSshKeys={onManageSshKeys} />
        case 'intel-profiles': return <IntelligenceScreen settings={settings} mode='profiles' />
        case 'delivery-health': return <IntelligenceScreen settings={settings} mode='timeliness' />
        case 'rules-match': return <RulesScreen settings={settings} category='match' />
        case 'rules-analysis': return <RulesScreen settings={settings} category='analysis' />
        case 'rules-detection': return <RulesScreen settings={settings} category='detection' />
        case 'api-keys': return <OrganizationApiKeysScreen settings={settings} />
    }
}
