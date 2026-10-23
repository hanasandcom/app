import { expect, test } from 'bun:test'
import { caseWebsitePath, monitoredActorsWebsitePath, websitePageUrl } from './workspace-links'
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

test('TI administration handoffs use the owning website routes instead of dynamic search aliases', () => {
    for (const [path, target] of Object.entries({ activity: 'activity', sources: 'sources', runs: 'runs', profiles: 'enrichment', enrichment: 'enrichment', timeliness: 'timeliness' })) {
        const url = new URL(websitePageUrl('https://hanasand.com', `/ti/${path}?page=2&q=actor%20name#evidence`, ''))
        expect(url.origin).toBe('https://ti.hanasand.com')
        expect(url.pathname).toBe(`/dashboard/ti/${target}`)
        expect(url.searchParams.get('q')).toBe('actor name')
        expect(url.searchParams.get('page')).toBe('2')
        expect(url.hash).toBe('#evidence')
    }
    expect(websitePageUrl('https://hanasand.com', '/ti/an-actor', '')).toBe('https://hanasand.com/ti/an-actor')
})

test('website handoffs retain configured origins, base paths and record identity', () => {
    expect(websitePageUrl('https://website.synthetic.invalid/prefix/', '/ti/activity?page=2', '')).toBe('https://website.synthetic.invalid/prefix/ti/activity?page=2')
    expect(websitePageUrl('https://website.synthetic.invalid', '/ti/profiles', 'https://intelligence.synthetic.invalid')).toBe('https://intelligence.synthetic.invalid/dashboard/ti/enrichment')
    const path = caseWebsitePath({ caseId: 'HA-42', alertId: 'alert', organizationId: 'org' })
    expect(websitePageUrl('https://hanasand.com', path, '')).toBe(`https://hanasand.com${path}`)
    expect(websitePageUrl('https://hanasand.com', '/logs?service=a%20b', '')).toBe('https://hanasand.com/logs?service=a%20b')
})

test('website handoffs reject external paths and unsafe configured addresses before opening a browser', () => {
    for (const path of ['https://other.invalid/', '//other.invalid/', '/\\other.invalid', '/ti/\nactivity', '/ bad']) expect(() => websitePageUrl('https://hanasand.com', path, '')).toThrow()
    for (const base of ['http://hanasand.com', 'https://user:secret@hanasand.com', 'https://hanasand.com?token=x', 'https://hanasand.com#x']) expect(() => websitePageUrl(base, '/status', '')).toThrow()
    expect(() => websitePageUrl('https://hanasand.com', '/ti/activity', 'http://ti.hanasand.com')).toThrow()
})
