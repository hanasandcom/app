import type { AppSettings } from '../types'
import { PublishingScreen, type PublishingServices } from '../features/publishing/PublishingScreen'

export default function ThoughtsScreen({ settings, services }: { settings: AppSettings; services?: PublishingServices }) {
    return <PublishingScreen settings={settings} services={services} kind='thoughts' />
}
