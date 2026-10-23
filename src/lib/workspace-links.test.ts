import { expect, test } from 'bun:test'
import { caseWebsitePath, monitoredActorsWebsitePath } from './workspace-links'
test('case handoffs preserve case, alert, organization and source-route identities', () => {
    const ref = { caseId: 'HA-42', alertId: 'alert:@', organizationId: 'org one' }
    const delivery = new URL(caseWebsitePath(ref), 'https://synthetic.invalid')
    expect(delivery.pathname).toBe('/cases/HA-42')
    expect([...delivery.searchParams]).toEqual([['organizationId', 'org one'], ['alertId', 'alert:@'], ['route', 'delivery_history']])
    const findings = new URL(caseWebsitePath({ ...ref, route: 'alert_queue' }), 'https://synthetic.invalid')
    expect(findings.searchParams.get('route')).toBe('alert_queue')
    const personal = new URL(caseWebsitePath({ caseId: ref.caseId, alertId: ref.alertId, route: 'alert_queue' }), 'https://synthetic.invalid')
    expect(personal.searchParams.has('organizationId')).toBe(false)
    expect(personal.searchParams.get('alertId')).toBe(ref.alertId)
})
test('handoffs encode untrusted values and reject absent or malformed identities', () => {
    const link = new URL(caseWebsitePath({ caseId: 'a/b?c', alertId: 'a&route=other', organizationId: 'o&admin=1' }), 'https://synthetic.invalid')
    expect(link.pathname).toBe('/cases/a%2Fb%3Fc')
    expect(link.searchParams.get('alertId')).toBe('a&route=other')
    expect(link.searchParams.get('route')).toBe('delivery_history')
    expect(link.searchParams.has('admin')).toBe(false)
    for (const value of ['', '.', '..', 'a\n', 'a'.repeat(201)]) {
        expect(() => caseWebsitePath({ caseId: value, alertId: 'alert' })).toThrow()
        expect(() => monitoredActorsWebsitePath(value)).toThrow()
    }
    const actors = new URL(monitoredActorsWebsitePath('org one'), 'https://synthetic.invalid')
    expect(actors.pathname).toBe('/findings/actors')
    expect(actors.searchParams.get('organizationId')).toBe('org one')
})
