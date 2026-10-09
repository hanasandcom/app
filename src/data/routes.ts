import type { RouteShortcut } from '../types'

export const routeShortcuts: RouteShortcut[] = [
    { title: 'Dashboard', path: '/dashboard', summary: 'Main control surface for the website.', category: 'Core' },
    { title: 'Overview', path: '/dashboard', summary: 'General site and service overview.', category: 'Core' },
    { title: 'Mail', path: '/mail', summary: 'Full mail workspace from the website.', category: 'Core' },
    { title: 'AI Workspace', path: '/ai', summary: 'Hanasand AI and Codex-adjacent workflows.', category: 'AI' },
    { title: 'AI Window', path: '/ai/window', summary: 'Compact AI surface for remote use.', category: 'AI' },
    { title: 'System AI', path: '/system/ai', summary: 'System AI operations and monitoring.', category: 'AI' },
    { title: 'Shares', path: '/s', summary: 'Create and manage shares.', category: 'Content' },
    { title: 'Share Gallery', path: '/g', summary: 'Shared project and content surfaces.', category: 'Content' },
    { title: 'Uploads', path: '/upload', summary: 'Upload flows and file handling.', category: 'Content' },
    { title: 'Articles', path: '/content/articles', summary: 'Article management and publishing.', category: 'Content' },
    { title: 'Thoughts', path: '/content/thoughts', summary: 'Thoughts and notes management.', category: 'Content' },
    { title: 'VMs', path: '/vms', summary: 'VM list and remote management.', category: 'Infra' },
    { title: 'System', path: '/system', summary: 'System tools and admin surfaces.', category: 'Infra' },
    { title: 'Traffic', path: '/traffic', summary: 'Traffic and observability views.', category: 'Infra' },
    { title: 'Logs', path: '/logs', summary: 'Logs and runtime insight.', category: 'Infra' },
    { title: 'Vulnerabilities', path: '/vulnerabilities', summary: 'Security and scan summaries.', category: 'Infra' },
    { title: 'Database', path: '/db', summary: 'Database operations.', category: 'Infra' },
    { title: 'Users', path: '/users', summary: 'User administration.', category: 'Admin' },
    { title: 'Roles', path: '/role', summary: 'Role administration.', category: 'Admin' },
    { title: 'Profile', path: '/profile', summary: 'Profile and account page.', category: 'Admin' },
]
