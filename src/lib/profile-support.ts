export type CustomerSupportInputState = {
    mounted: boolean
    writing: boolean
    locked: boolean
    generation: number
    selection: string
}
export function canEditCustomerSupportInput(current: CustomerSupportInputState, generation: number, selection: string) {
    return current.mounted && !current.writing && !current.locked
        && current.generation === generation && current.selection === selection
}
