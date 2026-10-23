import type { AppSettings } from '../../types'
import { ServiceAccountError, requireWriter } from './model'
import type { AccountController, Operation } from './controller'
import type { Services } from './api'
export function acceptsAccountResult(settings: AppSettings, controller: AccountController, operation: Operation) { return controller.operationCurrent(operation) && controller.sessionCurrent(settings) }
export async function freshAccountWrite(settings: AppSettings, services: Services, controller: AccountController, operation: Operation) {
    const ensure = () => { if (!acceptsAccountResult(settings, controller, operation)) throw new ServiceAccountError('The current account or operation changed.', 403) }
    ensure(); const access = await services.loadAccess(settings, operation.signal); ensure(); requireWriter(settings, access)
    const directory = await services.loadDirectory(settings, operation.signal); ensure(); requireWriter(settings, access)
    if (operation.action !== 'create' && !directory.accounts.some(row => row.id === operation.target && row.active)) throw new ServiceAccountError('Refresh and select a current active service account.', 409)
    return { access, directory }
}
