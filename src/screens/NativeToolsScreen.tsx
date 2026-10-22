import type { AppSettings, RootTabParamList } from '../types'
import { ThreatSearchScreen } from './ThreatSearchScreen'
import { PasswordCheckScreen } from './PasswordCheckScreen'
import { SubscriptionScreen } from './SubscriptionScreen'
import { HostUpdatesScreen } from './HostUpdatesScreen'
import { HostsScreen } from './HostsScreen'
import { IntelligenceScreen } from './IntelligenceScreen'
import { RulesScreen } from './RulesScreen'
import { OrganizationApiKeysScreen } from './OrganizationApiKeysScreen'

export function NativeToolsScreen({ settings, tool, onManageSshKeys }: { settings: AppSettings; tool: RootTabParamList['Tools']['tool']; onManageSshKeys: () => void }) {
    switch (tool) {
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
