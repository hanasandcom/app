import { describe, expect, it } from 'bun:test'
import { isSandboxFirstPartyNavigation } from './sandbox-navigation'

describe('Sandbox viewport navigation policy', () => {
    it('allows HTTPS Hanasand hosts and blocks lookalikes or cleartext', () => {
        expect(isSandboxFirstPartyNavigation('https://hanasand.com/sandbox')).toBe(true)
        expect(isSandboxFirstPartyNavigation('https://browsers.hanasand.com/session')).toBe(true)
        expect(isSandboxFirstPartyNavigation('https://hanasand.com.attacker.test/')).toBe(false)
        expect(isSandboxFirstPartyNavigation('http://hanasand.com/')).toBe(false)
        expect(isSandboxFirstPartyNavigation('not a URL')).toBe(false)
    })
})
