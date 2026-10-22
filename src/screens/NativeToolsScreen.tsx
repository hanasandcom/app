import type { AppSettings, RootTabParamList } from '../types'
import { ThreatSearchScreen } from './ThreatSearchScreen'
import { PasswordCheckScreen } from './PasswordCheckScreen'
import { SubscriptionScreen } from './SubscriptionScreen'
import { HostUpdatesScreen } from './HostUpdatesScreen'
import { HostsScreen } from './HostsScreen'

export function NativeToolsScreen({ settings, tool, onManageSshKeys }: { settings: AppSettings; tool: RootTabParamList['Tools']['tool']; onManageSshKeys: () => void }) {
    switch (tool) {
        case 'threat-search': return <ThreatSearchScreen settings={settings} />
        case 'password-check': return <PasswordCheckScreen settings={settings} />
        case 'subscription': return <SubscriptionScreen settings={settings} />
        case 'host-updates': return <HostUpdatesScreen settings={settings} />
        case 'hosts': return <HostsScreen settings={settings} onManageSshKeys={onManageSshKeys} />
    }
}
