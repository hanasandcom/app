import { SupportDeskScreen } from './SupportDeskScreen'
import { OrganizationDirectoryScreen } from './OrganizationDirectoryScreen'
import { DeliveryHistoryScreen } from './DeliveryHistoryScreen'
import { IntegrationsScreen } from './IntegrationsScreen'
import { AiMetricsScreen } from './AiMetricsScreen'
import type { DeliveryCaseRef } from '../lib/delivery-history'
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

export function NativeToolsScreen({ settings, tool, onManageSshKeys, onSelectOrganization, onConfigureDelivery, onOpenCase, onViewAiLogs }: {
    settings: AppSettings; tool: RootTabParamList['Tools']['tool']; onManageSshKeys: () => void
    onSelectOrganization: (id: string) => void; onConfigureDelivery: () => void
    onOpenCase: (ref: DeliveryCaseRef) => void; onViewAiLogs: (containerName: string) => void
}) {
    switch (tool) {
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
        case 'threat-search': return <ThreatSearchScreen settings={settings} />
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
