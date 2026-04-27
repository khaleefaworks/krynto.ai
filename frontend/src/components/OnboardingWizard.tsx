import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, CheckCircle2, Globe, Code2, Users, Rocket, ChevronRight, ChevronLeft, Copy, Check, PanelsTopLeft } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { apiRequest } from '@/services/api'
import { API_BASE } from '@/config/endpoints'

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

type WizardStep = {
    id: number
    eyebrow: string
    title: string
    description: string
    actionLabel: string
    hint?: string | null
    icon: typeof Globe
    accentClass: string
    action: () => void
    renderExtra?: () => ReactNode
}

const ONBOARDING_STORAGE_VERSION = 'v3'
const TOTAL_STEPS = 4

function getScopeKey(scope: OnboardingScope, suffix: string) {
    return [
        'onboarding',
        ONBOARDING_STORAGE_VERSION,
        suffix,
        scope.orgId ?? 'unknown-org',
        scope.orgSlug ?? 'unknown-slug',
        scope.userId ?? 'unknown-user',
        scope.role ?? 'unknown-role',
    ].join('_')
}

function loadCompletedSteps(scope: OnboardingScope): number[] {
    try {
        const raw = localStorage.getItem(getScopeKey(scope, 'steps'))
        const parsed = raw ? JSON.parse(raw) : []
        return Array.isArray(parsed)
            ? parsed.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value < TOTAL_STEPS)
            : []
    } catch {
        return []
    }
}

function persistCompletedSteps(scope: OnboardingScope, steps: number[]) {
    try {
        localStorage.setItem(getScopeKey(scope, 'steps'), JSON.stringify(Array.from(new Set(steps)).sort((a, b) => a - b)))
    } catch {
        // ignore storage failures
    }
}

function addCompletedStep(scope: OnboardingScope, stepId: number): number[] {
    const next = Array.from(new Set([...loadCompletedSteps(scope), stepId])).sort((a, b) => a - b)
    persistCompletedSteps(scope, next)
    return next
}

function mergeCompletedSteps(base: number[], additions: number[]): number[] {
    return Array.from(new Set([...(base || []), ...(additions || [])])).sort((a, b) => a - b)
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
    } catch {
        // ignore storage failures
    }
}

export function hasCompletedOnboarding(scope: OnboardingScope): boolean {
    return loadCompletedSteps(scope).length >= TOTAL_STEPS
}

function getFirstIncompleteStep(completedSteps: number[]) {
    return [0, 1, 2, 3].find((stepId) => !completedSteps.includes(stepId)) ?? (TOTAL_STEPS - 1)
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

    const [currentStep, setCurrentStep] = useState(0)
    const [completedSteps, setCompletedSteps] = useState<number[]>([])
    const [firstWebsite, setFirstWebsite] = useState<{ id: number; widget_key: string; name: string } | null>(null)
    const [copied, setCopied] = useState(false)

    const syncGuideState = async () => {
        const persisted = loadCompletedSteps(scope)
        const autoCompleted: number[] = []

        try {
            const websiteData = await apiRequest<any>('/websites?limit=1')
            const sites = Array.isArray(websiteData) ? websiteData : (websiteData.websites ?? websiteData.items ?? [])
            const firstSite = sites.length > 0 ? sites[0] : null
            setFirstWebsite(firstSite)
            if (firstSite) autoCompleted.push(0)
        } catch {
            setFirstWebsite(null)
        }

        try {
            const users = await apiRequest<any[]>('/users')
            const memberCount = Array.isArray(users) ? users.length : 0
            if (memberCount > 1) autoCompleted.push(2)
        } catch {
            // best-effort only
        }

        const nextCompleted = mergeCompletedSteps(persisted, autoCompleted)
        persistCompletedSteps(scope, nextCompleted)
        setCompletedSteps(nextCompleted)
        setCurrentStep(getFirstIncompleteStep(nextCompleted))
    }

    useEffect(() => {
        if (!open) return

        setCopied(false)
        setFirstWebsite(null)
        void syncGuideState()
    }, [open, scope.orgId, scope.orgSlug, scope.userId, scope.role])

    useEffect(() => {
        if (!open) return

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }

        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [open, onClose])

    if (!open) return null

    const markStepDone = (stepId: number) => {
        const nextCompleted = addCompletedStep(scope, stepId)
        setCompletedSteps(nextCompleted)
        setCurrentStep(getFirstIncompleteStep(nextCompleted))
    }

    const next = () => setCurrentStep((step) => Math.min(step + 1, TOTAL_STEPS - 1))
    const back = () => setCurrentStep((step) => Math.max(step - 1, 0))

    const embedSnippet = firstWebsite
        ? `<script\n  src="${API_BASE}/static/chat-widget.js"\n  data-website-id="${firstWebsite.id}"\n  data-widget-key="${firstWebsite.widget_key}"\n  async\n></script>`
        : ''

    const copySnippet = () => {
        if (!embedSnippet) return

        navigator.clipboard.writeText(embedSnippet)
            .then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
            })
            .catch(() => {
                // ignore clipboard failures
            })
    }

    const steps: WizardStep[] = [
        {
            id: 0,
            eyebrow: 'Website setup',
            title: 'Create your first website',
            description: 'Add a website first so the system can generate your live chat widget and settings.',
            actionLabel: 'Open websites',
            hint: 'You only need one website to get started.',
            icon: Globe,
            accentClass: 'text-sky-600 dark:text-sky-300',
            action: () => {
                markStepDone(0)
                navigate('/dashboard/settings/websites')
                onClose()
            },
        },
        {
            id: 1,
            eyebrow: 'Widget install',
            title: 'Install the chat widget',
            description: 'Copy the snippet and place it before the closing body tag on your website so visitors can start chatting.',
            actionLabel: 'Mark installed',
            hint: firstWebsite ? null : 'Create a website first to unlock the install snippet.',
            icon: Code2,
            accentClass: 'text-indigo-600 dark:text-indigo-300',
            action: () => {
                markStepDone(1)
                next()
            },
            renderExtra: () => firstWebsite ? (
                <div className="mt-6 space-y-4">
                    <div className="rounded-3xl border border-slate-200 bg-slate-950 p-5 shadow-sm dark:border-slate-800">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                <PanelsTopLeft className="h-3.5 w-3.5" />
                                Install snippet
                            </div>
                            <button
                                onClick={copySnippet}
                                className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800"
                                title="Copy install snippet"
                            >
                                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                                {copied ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                        <pre className="overflow-x-auto whitespace-pre text-xs leading-relaxed text-emerald-300">{embedSnippet}</pre>
                    </div>

                    <div className="rounded-3xl border border-sky-100 bg-sky-50 px-4 py-4 dark:border-sky-900/50 dark:bg-sky-950/30">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-300">Website</div>
                        <div className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{firstWebsite.name}</div>
                    </div>
                </div>
            ) : (
                <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 px-4 py-4 dark:border-amber-900/40 dark:bg-amber-950/30">
                    <p className="text-sm text-amber-800 dark:text-amber-200">Create a website first to unlock the widget snippet.</p>
                </div>
            ),
        },
        {
            id: 2,
            eyebrow: 'Team setup',
            title: 'Invite your team',
            description: 'Add managers or agents so chats are handled by the right people from day one.',
            actionLabel: 'Open team settings',
            hint: 'You can come back later, but setup is smoother once your team is added.',
            icon: Users,
            accentClass: 'text-emerald-600 dark:text-emerald-300',
            action: () => {
                markStepDone(2)
                navigate('/dashboard/settings/users')
                onClose()
            },
        },
        {
            id: 3,
            eyebrow: 'Go live',
            title: 'Finish setup and start chatting',
            description: 'Once these basics are in place, your workspace is ready and you can reopen this guide from the sidebar any time.',
            actionLabel: 'Finish setup',
            hint: 'The guide will stop auto-opening once all steps are marked complete.',
            icon: Rocket,
            accentClass: 'text-fuchsia-600 dark:text-fuchsia-300',
            action: () => {
                markStepDone(3)
                onClose()
            },
        },
    ]

    const step = steps[currentStep]
    const StepIcon = step.icon
    const isLastStep = currentStep === steps.length - 1
    const completionCount = completedSteps.length
    const progressPercent = Math.round((completionCount / TOTAL_STEPS) * 100)

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm sm:p-6">
            <div className="flex h-[88vh] w-full max-w-5xl min-w-0 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-white shadow-2xl dark:bg-slate-900 md:min-w-[780px] md:h-[760px]">
                <div className="shrink-0 border-b border-slate-200/80 px-6 py-5 dark:border-slate-800 sm:px-8 sm:py-6">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600 dark:text-sky-300">Setup guide</div>
                            <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                                <div className="min-w-0">
                                    <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">Get your workspace ready</h2>
                                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300 sm:text-base">
                                        Four steps from a new organisation to a working live chat setup.
                                    </p>
                                </div>

                                <div className="min-w-0 rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.16),_transparent_42%),linear-gradient(180deg,#f8fbff_0%,#ffffff_100%)] px-4 py-3 dark:border-slate-700 dark:bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.16),_transparent_42%),linear-gradient(180deg,#0f172a_0%,#111827_100%)] lg:w-[320px]">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-lg font-semibold text-slate-900 dark:text-white">{completionCount}/4</div>
                                            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{progressPercent}% complete</div>
                                        </div>
                                        <div className="text-right text-xs text-slate-500 dark:text-slate-400">
                                            Auto-shows until setup is complete.
                                        </div>
                                    </div>
                                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                                        <div
                                            className="h-full rounded-full bg-[linear-gradient(90deg,#38bdf8_0%,#6366f1_60%,#a855f7_100%)] transition-all duration-300"
                                            style={{ width: `${Math.max(progressPercent, completionCount > 0 ? 10 : 0)}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                            <button
                                onClick={onDismiss}
                                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:px-4 sm:py-2 sm:text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                            >
                                Don't show again
                            </button>
                            <button
                                onClick={onClose}
                                className="inline-flex h-8 w-8 xl:h-11 xl:w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                                title="Close setup guide"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    {/* Mobile progress bar */}
                    <div className="xl:hidden mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div
                            className="h-full rounded-full bg-[linear-gradient(90deg,#38bdf8_0%,#6366f1_60%,#a855f7_100%)] transition-all duration-300"
                            style={{ width: `${Math.max(progressPercent, completionCount > 0 ? 10 : 0)}%` }}
                        />
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto xl:overflow-hidden px-4 py-4 sm:px-6 sm:py-6 xl:px-8 xl:py-8">
                    <div className="grid gap-4 xl:h-full xl:grid-cols-[300px_minmax(0,1fr)]">
                        {/* Step list — hidden on mobile, sidebar on xl */}
                        <div className="hidden xl:flex xl:flex-col min-h-0 overflow-y-auto pr-1">
                            <div className="space-y-3">
                                {steps.map((item, index) => {
                                    const ItemIcon = item.icon
                                    const isDone = completedSteps.includes(item.id)
                                    const isActive = currentStep === index

                                    return (
                                        <button
                                            key={item.id}
                                            onClick={() => setCurrentStep(index)}
                                            className={`w-full rounded-3xl border p-4 text-left transition-all ${isActive
                                                ? 'border-sky-300 bg-sky-50 shadow-sm dark:border-sky-700 dark:bg-sky-950/40'
                                                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700 dark:hover:bg-slate-900'
                                                }`}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 ${item.accentClass}`}>
                                                    <ItemIcon className="h-5 w-5" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">0{item.id + 1}</span>
                                                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${isDone
                                                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                                            : isActive
                                                                ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300'
                                                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                                            }`}>
                                                            {isDone ? 'Completed' : isActive ? 'Current' : 'Pending'}
                                                        </span>
                                                    </div>
                                                    <div className="mt-2 text-base font-semibold text-slate-900 dark:text-white">{item.title}</div>
                                                    <div className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{item.description}</div>
                                                </div>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        <div className="min-w-0 min-h-0">
                            <div className="flex h-full min-h-0 flex-col rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
                                <div className="shrink-0 border-b border-slate-200 px-6 py-6 dark:border-slate-800 sm:px-8">
                                    <div className="flex items-start gap-4">
                                        <div className={`inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-slate-100 dark:bg-slate-800 ${step.accentClass}`}>
                                            <StepIcon className="h-6 w-6" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600 dark:text-sky-300">{step.eyebrow}</div>
                                            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{step.title}</h3>
                                            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-base">{step.description}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 dark:[scrollbar-color:#334155_transparent] sm:px-8">
                                    {step.hint && (
                                        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                            {step.hint}
                                        </div>
                                    )}

                                    {step.renderExtra?.()}

                                    {completedSteps.includes(step.id) && (
                                        <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                            <CheckCircle2 className="h-4 w-4" />
                                            Marked as completed
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="shrink-0 border-t border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-6 sm:py-4 xl:px-8 xl:py-5">
                    <div className="flex items-center justify-between gap-3">
                        <div className="hidden xl:block text-sm text-slate-500 dark:text-slate-400">
                            Reopen this guide from the rocket in the sidebar whenever you need it.
                        </div>

                        <div className="flex items-center gap-2 w-full xl:w-auto xl:justify-end flex-wrap">
                            <button
                                onClick={back}
                                disabled={currentStep === 0}
                                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                                <ChevronLeft className="h-4 w-4" />
                                Back
                            </button>

                            {!isLastStep && (
                                <button
                                    onClick={() => {
                                        markStepDone(step.id)
                                        next()
                                    }}
                                    className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                                >
                                    Mark as completed
                                </button>
                            )}

                            <button
                                onClick={step.action}
                                className="flex-1 xl:flex-none inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
                            >
                                {step.actionLabel}
                                {!isLastStep && <ChevronRight className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
