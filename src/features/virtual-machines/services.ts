import * as api from './api'
import { openVmConsole } from './console'
import { loadToolOrganizations } from '../../lib/organization-tools'
export const vmServices = { ...api, openConsole: openVmConsole, organizations: loadToolOrganizations }
export type VmServices = typeof vmServices
