import { requireNativeModule } from 'expo-modules-core'

export type PinnedHttpsResponse = {
    status: number
    headers: Record<string, string>
    body: string
}

type PinnedHttpsModule = {
    request(url: string, pin: string, method: string, headers: Record<string, string>, body: string | null): Promise<PinnedHttpsResponse>
}

export default requireNativeModule<PinnedHttpsModule>('HanasandPinnedHttps')
