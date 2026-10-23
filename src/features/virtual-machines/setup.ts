import { object, list, string } from './model'
import { VmError, utf8Size } from './transport'
export const setupServices = ['nodejs', 'postgresql', 'mysql', 'sqlite', 'redis', 'python', 'bun', 'rust', 'ruby', 'cpp', 'docker', 'java', 'go', 'php', 'nginx', 'website', 'minecraft-java'] as const
export type SetupService = typeof setupServices[number]
export const operatingSystems = ['ubuntu-22.04', 'ubuntu-24.04', 'ubuntu-26.04', 'ubuntu-24.04-desktop'] as const
export type OperatingSystem = typeof operatingSystems[number]
export const resourcePlans = [{ cpu: '1', memory: '2GiB', disk: '10GiB' }, { cpu: '2', memory: '4GiB', disk: '20GiB' }, { cpu: '4', memory: '8GiB', disk: '40GiB' }] as const
export type Resources = typeof resourcePlans[number]
export const minecraftTypes = ['PAPER', 'VANILLA', 'FABRIC', 'QUILT', 'NEOFORGE', 'PURPUR', 'FOLIA'] as const
export type MinecraftType = typeof minecraftTypes[number]
export type WebsitePlan = { title: string; tagline: string; sections: { heading: string; body: string }[]; gallery?: { url: string; alt: string; caption: string }[]; contactEmail?: string }
export type ProjectFile = { path: string; content: string }
export type SetupPlan = { summary: string; services: SetupService[]; packages: string[]; website: WebsitePlan | null; minecraftServerType: MinecraftType | null; projectFiles?: ProjectFile[] }
export type CreateVmInput = {
    name: string; os: OperatingSystem; resources: Resources; services: SetupService[]; custom_apt_packages?: string[]
    minecraft_eula_accepted?: boolean; minecraft_server_type?: MinecraftType; website?: WebsitePlan | null
    project_files?: ProjectFile[]; organization_id?: string | null
}
function choice<T extends string>(value: unknown, values: readonly T[]): T { if (typeof value !== 'string' || !values.includes(value as T)) throw new VmError('Choose a supported VM setup option.'); return value as T }
export function httpsUrl(value: unknown) {
    const input = string(value, 4096)
    let url: URL
    try { url = new URL(input) } catch { throw new VmError('A valid secure link is required.') }
    if (url.protocol !== 'https:' || url.username || url.password) throw new VmError('A secure link without embedded credentials is required.')
    return input
}
export function parseWebsite(value: unknown): WebsitePlan {
    const r = object(value), title = string(r.title, 120)
    if (!title.trim()) throw new VmError('Enter a website title.')
    const sections = list(r.sections, 5).map(value => { const section = object(value); return { heading: string(section.heading, 100), body: string(section.body, 500) } })
    const gallery = r.gallery === undefined ? undefined : list(r.gallery, 8).map(value => {
        const image = object(value), alt = string(image.alt, 240)
        if (!alt.trim()) throw new VmError('Enter an image description.')
        return { url: httpsUrl(image.url), alt, caption: string(image.caption, 240) }
    })
    const contactEmail = r.contactEmail === undefined ? undefined : string(r.contactEmail, 254)
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new VmError('Enter a valid contact email.')
    return { title, tagline: string(r.tagline, 120), sections, ...(gallery ? { gallery } : {}), ...(contactEmail === undefined ? {} : { contactEmail }) }
}
function packages(value: unknown) {
    return [...new Set(list(value, 12).map(v => { const p = string(v, 128); if (!/^[a-z0-9][a-z0-9+.-]*$/.test(p)) throw new VmError('Choose supported Ubuntu package names.'); return p }))].sort()
}
export function parseProjectFiles(value: unknown): ProjectFile[] {
    let total = 0
    const seen = new Set<string>()
    const files = list(value, 96).map(value => {
        const r = object(value), path = string(r.path, 180), content = string(r.content, 49152)
        const parts = path.split('/')
        if (!path || !/^[A-Za-z0-9_.@/-]+$/.test(path) || parts.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.env' || part.toLowerCase().startsWith('.env.') || ['node_modules', '.next', '.git'].includes(part.toLowerCase())) || seen.has(path)) throw new VmError('Project files contain an unsupported or duplicate path.')
        const size = utf8Size(content); total += size
        if (size > 48 * 1024 || total > 120 * 1024) throw new VmError('The generated project exceeds its size limit.')
        seen.add(path); return { path, content }
    })
    const manifest = files.find(file => file.path === 'package.json')
    if (!manifest) throw new VmError('The generated project has no package manifest.')
    let pkg: Record<string, unknown>
    try { pkg = object(JSON.parse(manifest.content)) } catch { throw new VmError('The generated package manifest is invalid.') }
    const scripts = object(pkg.scripts), dependencies = { ...(pkg.dependencies ? object(pkg.dependencies) : {}), ...(pkg.devDependencies ? object(pkg.devDependencies) : {}) }
    if (!['next', 'react', 'react-dom'].every(key => Object.hasOwn(dependencies, key)) || scripts.build !== 'next build' || scripts.start !== 'next start --hostname 0.0.0.0 --port 3000' || ['prebuild', 'postbuild', 'prestart', 'poststart'].some(key => Object.hasOwn(scripts, key))) throw new VmError('The generated project has unsupported build or start settings.')
    return files
}
export function parseSetupPlan(value: unknown): SetupPlan {
    const r = object(value), services = list(r.services, setupServices.length).map(v => choice(v, setupServices))
    const result: SetupPlan = { summary: string(r.summary, 400), services, packages: packages(r.packages), website: r.website === null ? null : parseWebsite(r.website), minecraftServerType: r.minecraftServerType === null ? null : choice(r.minecraftServerType, minecraftTypes) }
    if (r.projectFiles !== undefined) result.projectFiles = parseProjectFiles(r.projectFiles)
    if (!result.services.length && !result.packages.length && !result.website && !result.projectFiles?.length) throw new VmError('The setup response contains no supported setup.')
    return result
}
export function createPayload(value: CreateVmInput): CreateVmInput {
    if (!/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(value.name)) throw new VmError('Use 2–63 lowercase letters, numbers or hyphens, starting with a letter.')
    const os = choice(value.os, operatingSystems), resources = resourcePlans.find(p => p.cpu === value.resources?.cpu && p.memory === value.resources?.memory && p.disk === value.resources?.disk)
    if (!resources) throw new VmError('Choose a supported resource plan.')
    const services = [...new Set(list(value.services, setupServices.length).map(v => choice(v, setupServices)))], minecraft = services.includes('minecraft-java')
    if (minecraft !== (value.minecraft_eula_accepted === true) || minecraft && resources.memory === '2GiB') throw new VmError('Minecraft requires EULA acceptance and at least the medium resource plan.')
    if (os === 'ubuntu-24.04-desktop' && resources.memory !== '8GiB') throw new VmError('Ubuntu Desktop requires the largest resource plan.')
    const website = value.website == null ? value.website : parseWebsite(value.website), project = value.project_files === undefined ? undefined : parseProjectFiles(value.project_files)
    if (website && !services.includes('website') || project && (!services.includes('nodejs') || resources.memory === '2GiB')) throw new VmError('Choose the services and resources required by this website or project.')
    if (value.minecraft_server_type !== undefined && !minecraft) throw new VmError('A Minecraft server type requires the Minecraft service.')
    return { name: value.name, os, resources: { ...resources }, services, ...(value.custom_apt_packages === undefined ? {} : { custom_apt_packages: packages(value.custom_apt_packages) }),
        ...(value.minecraft_eula_accepted === undefined ? {} : { minecraft_eula_accepted: value.minecraft_eula_accepted }), ...(value.minecraft_server_type === undefined ? {} : { minecraft_server_type: choice(value.minecraft_server_type, minecraftTypes) }),
        ...(website === undefined ? {} : { website }), ...(project === undefined ? {} : { project_files: project }), ...(value.organization_id === undefined ? {} : { organization_id: value.organization_id }) }
}
