import type { CreateVmInput } from './setup'
// Component-owned nonsecret memory survives temporary editor removal during reads. Never enters the intent registry or disk.
export type VmEditorState = { draft: CreateVmInput; prompt: string; packages: string; summary: string; error: string; confirmation: string; suggestedKey: string }
export type VmEditorMemory = Partial<VmEditorState>
export function editorValue<K extends keyof VmEditorState>(memory: VmEditorMemory | undefined, key: K, initial: VmEditorState[K]): VmEditorState[K] { return memory?.[key] ?? initial }
export function saveEditorValue<K extends keyof VmEditorState>(memory: VmEditorMemory | undefined, key: K, value: VmEditorState[K]) { if (memory) memory[key] = value }
