import type { RootTabParamList } from '../types'

const tools: Record<string, RootTabParamList['Tools']['tool']> = {
    '/ti': 'threat-search',
    '/pwned': 'password-check',
    '/subscription': 'subscription',
    '/system/updates': 'host-updates',
    '/system/hosts': 'hosts',
    '/ti/profiles': 'intel-profiles',
    '/ti/timeliness': 'delivery-health',
    '/organizations/api-keys': 'api-keys',
    '/rules/match': 'rules-match',
    '/rules/analysis': 'rules-analysis',
    '/rules/detection': 'rules-detection',
}

export function nativeToolForPath(path?: string) {
    return path ? tools[path] : undefined
}
