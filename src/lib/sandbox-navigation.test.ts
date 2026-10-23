import { describe, expect, it } from 'bun:test'
import { isSandboxCookieOrigin, isSandboxFirstPartyNavigation } from './sandbox-navigation'

describe('Sandbox viewport navigation policy', () => {
    it('allows HTTPS Hanasand hosts and blocks lookalikes or cleartext', () => {
        expect(isSandboxFirstPartyNavigation('https://hanasand.com/sandbox')).toBe(true)
        expect(isSandboxFirstPartyNavigation('https://browsers.hanasand.com/session')).toBe(true)
        expect(isSandboxFirstPartyNavigation('https://hanasand.com.attacker.test/')).toBe(false)
        expect(isSandboxFirstPartyNavigation('http://hanasand.com/')).toBe(false)
        expect(isSandboxFirstPartyNavigation('not a URL')).toBe(false)
    })

    it('injects the app session only into the exact first-party web origin', () => {
        expect(isSandboxCookieOrigin('https://hanasand.com/')).toBe(true)
        expect(isSandboxCookieOrigin('https://identity.hanasand.com/')).toBe(false)
        expect(isSandboxCookieOrigin('https://browsers.hanasand.com/')).toBe(false)
        expect(isSandboxCookieOrigin('http://hanasand.com/')).toBe(false)
    })
})
