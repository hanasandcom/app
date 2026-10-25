import { describe, expect, test } from 'bun:test'
import { organizationLifecycleActions, organizationLifecycleTarget } from './organization-lifecycle-actions'

describe('organization lifecycle actions', () => {
    test('active organizations can be archived or deleted', () => {
        expect(organizationLifecycleActions('active')).toEqual(['archive', 'delete'])
    })

    test('archived organizations can be reactivated or deleted', () => {
        expect(organizationLifecycleActions('archived')).toEqual(['reactivate', 'delete'])
    })

    test('deleted, missing and unknown lifecycle states expose no actions', () => {
        for (const status of ['deleted', undefined, null, '', 'paused'])
            expect(organizationLifecycleActions(status)).toEqual([])
    })

    test('maps lifecycle menu actions to the website API statuses', () => {
        expect(organizationLifecycleTarget('archive')).toBe('archived')
        expect(organizationLifecycleTarget('reactivate')).toBe('active')
        expect(organizationLifecycleTarget('delete')).toBe('deleted')
    })
})
