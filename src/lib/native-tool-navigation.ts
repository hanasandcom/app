import type { RootTabParamList } from '../types'

const tools: Record<string, RootTabParamList['Tools']['tool']> = {
    '/management/users': 'user-management',
    '/findings': 'findings',
    '/rules/tuning': 'rule-tuning',
    '/api': 'api-reference',
    '/api/openapi': 'openapi-json',
    '/support': 'support-desk',
    '/management/organizations': 'organization-directory',
    '/findings/delivery': 'delivery-history',
    '/findings/actions': 'integrations',
    '/system/ai': 'ai-metrics',
    '/traffic/map': 'traffic-map',
    '/traffic': 'traffic-overview',
    '/traffic/recent': 'traffic-recent',
    '/system/rates': 'rate-limits',
    '/db': 'database',
    '/db/backups': 'backups',
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
