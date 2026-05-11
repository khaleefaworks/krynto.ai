import { useState, useEffect } from 'react'
import { Download, X } from 'lucide-react'

const DISMISS_KEY = 'aica_install_prompt_dismissed'

export default function InstallPromptBanner() {
    const [prompt, setPrompt] = useState<Event | null>(null)
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        // Don't show if already running as installed PWA.
        if (window.matchMedia('(display-mode: standalone)').matches) return
        // Don't show if permanently dismissed.
        if (localStorage.getItem(DISMISS_KEY) === '1') return

        const handler = (e: Event) => {
            e.preventDefault()
            setPrompt(e)
            setVisible(true)
        }

        window.addEventListener('beforeinstallprompt', handler)
        return () => window.removeEventListener('beforeinstallprompt', handler)
    }, [])

    const handleInstall = async () => {
        if (!prompt) return
        ;(prompt as any).prompt()
        const { outcome } = await (prompt as any).userChoice
        if (outcome === 'accepted') {
            setVisible(false)
            setPrompt(null)
        }
    }

    const handleDismiss = () => {
        setVisible(false)
        setPrompt(null)
        try { localStorage.setItem(DISMISS_KEY, '1') } catch { }
    }

    if (!visible) return null

    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4 sm:px-0 pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg px-4 py-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                    <Download className="h-4 w-4 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white leading-snug">
                        Install ChatAssist
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Add to home screen for faster access
                    </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                        onClick={handleInstall}
                        className="text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 px-3 py-1.5 rounded-lg transition-colors"
                    >
                        Install
                    </button>
                    <button
                        onClick={handleDismiss}
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        aria-label="Dismiss"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    )
}
