import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, CheckCircle2, Circle, ChevronRight } from 'lucide-react'
import { useAppStore } from '@/store/appStore'

interface OnboardingWizardProps {
    open: boolean
    onClose: () => void
    onDismiss: () => void
}

export type OnboardingScope = {
    orgId?: number | null
    orgSlug?: string | null
    userId?: number | null
    role?: string | null
}

type SetupItem = {
    id: number
    title: string
    description: string
    path: string
}

// Placeholder items — update titles/descriptions/paths once design is approved
const SETUP_ITEMS: SetupItem[] = [
    {
        id: 0,
        title: 'Create your first website',
        description: 'Add a website to generate your live chat widget and settings.',
        path: '/dashboard/settings/websites',
    },
    {
        id: 1,
        title: 'Install the chat widget',
        description: 'Copy the embed snippet and paste it on your website.',
        path: '/dashboard/settings/websites',
    },
    {
        id: 2,
        title: 'Invite your team',
        description: 'Add agents so chats are handled by the right people.',
        path: '/dashboard/settings/users',
    },
    {
        id: 3,
        title: 'Set up automations',
        description: 'Configure automated messages and chatbot flows.',
        path: '/dashboard/settings/websites',
    },
    {
        id: 4,
        title: 'Configure notifications',
        description: 'Set up push notifications and sound preferences.',
        path: '/dashboard/settings/notifications',
    },
]

const STORAGE_VERSION = 'v4'

function getScopeKey(scope: OnboardingScope, suffix: string) {
    return ['onboarding', STORAGE_VERSION, suffix, scope.orgId ?? 'x', scope.userId ?? 'x'].join('_')
}

function loadDone(scope: OnboardingScope): Set<number> {
    try {
        const raw = localStorage.getItem(getScopeKey(scope, 'done'))
        const arr = raw ? JSON.parse(raw) : []
        return new Set(Array.isArray(arr) ? arr.map(Number) : [])
    } catch {
        return new Set()
    }
}

function saveDone(scope: OnboardingScope, done: Set<number>) {
    try {
        localStorage.setItem(getScopeKey(scope, 'done'), JSON.stringify(Array.from(done)))
    } catch { /* ignore */ }
}

export function isDismissed(scope: OnboardingScope): boolean {
    try {
        return localStorage.getItem(getScopeKey(scope, 'dismissed')) === '1'
    } catch {
        return false
    }
}

export function dismissOnboarding(scope: OnboardingScope) {
    try {
        localStorage.setItem(getScopeKey(scope, 'dismissed'), '1')
    } catch { /* ignore */ }
}

export function hasCompletedOnboarding(scope: OnboardingScope): boolean {
    return loadDone(scope).size >= SETUP_ITEMS.length
}

export default function OnboardingWizard({ open, onClose, onDismiss }: OnboardingWizardProps) {
    const navigate = useNavigate()
    const { user, organization } = useAppStore()

    const scope: OnboardingScope = {
        orgId: organization?.id ?? user?.organization_id ?? null,
        orgSlug: organization?.slug ?? null,
        userId: user?.id ?? null,
        role: user?.role ?? null,
    }

    const [done, setDone] = useState<Set<number>>(new Set())

    useEffect(() => {
        if (open) setDone(loadDone(scope))
    }, [open, scope.orgId, scope.userId])

    if (!open) return null

    const toggleDone = (id: number, e: React.MouseEvent) => {
        e.stopPropagation()
        const next = new Set(done)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setDone(next)
        saveDone(scope, next)
    }

    const openItem = (path: string) => {
        navigate(path)
        onClose()
    }

    const completedCount = done.size
    const total = SETUP_ITEMS.length
    const progressPercent = total > 0 ? Math.round((completedCount / total) * 100) : 0

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-xl flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                    <div>
                        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Setup Guide</h2>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                            {completedCount} of {total} completed
                        </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                            onClick={onDismiss}
                            className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                            Don't show again
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-gray-800 transition-colors"
                            aria-label="Close"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Progress bar */}
                <div className="h-1 bg-gray-100 dark:bg-gray-800">
                    <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>

                {/* List */}
                <ul className="divide-y divide-gray-100 dark:divide-gray-800 overflow-y-auto max-h-[60vh]">
                    {SETUP_ITEMS.map((item) => {
                        const isDone = done.has(item.id)
                        return (
                            <li key={item.id}>
                                <button
                                    className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group"
                                    onClick={() => openItem(item.path)}
                                >
                                    {/* Check icon — click to toggle, stop row nav */}
                                    <span
                                        role="checkbox"
                                        aria-checked={isDone}
                                        className="flex-shrink-0"
                                        onClick={(e) => toggleDone(item.id, e)}
                                        title={isDone ? 'Mark as not done' : 'Mark as done'}
                                    >
                                        {isDone
                                            ? <CheckCircle2 className="h-5 w-5 text-green-500 hover:text-green-600 transition-colors" />
                                            : <Circle className="h-5 w-5 text-gray-300 dark:text-gray-600 group-hover:text-gray-400 hover:text-blue-400 transition-colors" />
                                        }
                                    </span>

                                    {/* Text */}
                                    <span className="flex-1 min-w-0">
                                        <span className={`block text-sm font-medium leading-snug ${isDone
                                            ? 'line-through text-gray-400 dark:text-gray-500'
                                            : 'text-gray-900 dark:text-white'
                                            }`}>
                                            {item.title}
                                        </span>
                                        <span className={`block text-xs mt-0.5 leading-relaxed ${isDone
                                            ? 'line-through text-gray-300 dark:text-gray-600'
                                            : 'text-gray-500 dark:text-gray-400'
                                            }`}>
                                            {item.description}
                                        </span>
                                    </span>

                                    {/* Arrow — only on pending rows */}
                                    <ChevronRight className={`flex-shrink-0 h-4 w-4 text-gray-300 dark:text-gray-600 transition-all ${isDone
                                        ? 'opacity-0'
                                        : 'opacity-0 group-hover:opacity-100 group-hover:text-gray-400 dark:group-hover:text-gray-500'
                                        }`}
                                    />
                                </button>
                            </li>
                        )
                    })}
                </ul>

                {/* Footer */}
                {completedCount === total && (
                    <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-green-50 dark:bg-green-950/30 flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                        <span className="text-xs font-medium text-green-700 dark:text-green-400">
                            All steps complete — you're all set!
                        </span>
                    </div>
                )}
            </div>
        </div>
    )
}
