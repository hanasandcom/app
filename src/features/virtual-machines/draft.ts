import type { CreateVmInput, SetupPlan, WebsitePlan } from './setup'
export function withWebsiteField(draft: CreateVmInput, patch: Partial<WebsitePlan>): WebsitePlan {
    return { title: '', tagline: '', sections: [], ...draft.website, ...patch }
}
export function applyVmPlan(draft: CreateVmInput, plan: SetupPlan): CreateVmInput {
    return { ...draft, services: [...plan.services], custom_apt_packages: [...plan.packages], website: plan.website,
        minecraft_server_type: plan.minecraftServerType || undefined, project_files: plan.projectFiles, minecraft_eula_accepted: false }
}
export function clearVmSuggestion(draft: CreateVmInput): CreateVmInput {
    return { ...draft, services: [], custom_apt_packages: [], website: undefined, minecraft_server_type: undefined, project_files: undefined, minecraft_eula_accepted: false }
}
