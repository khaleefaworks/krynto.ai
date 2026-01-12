import { useEffect } from 'react'
import { X } from 'lucide-react'

import { useAppStore } from '@/store/appStore'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function NotificationToasts() {
    const { notifications, dismissNotification } = useAppStore()

    // Auto-dismiss notifications after a short delay.
    useEffect(() => {
        if (!notifications.length) return

        const timers = notifications.map((n) =>
            window.setTimeout(() => {
                dismissNotification(n.id)
            }, 5000)
        )

        return () => {
            for (const t of timers) {
                window.clearTimeout(t)
            }
        }
    }, [notifications, dismissNotification])

    if (!notifications.length) return null

    return (
        <div className="fixed bottom-4 right-4 z-[60] flex w-[22rem] flex-col gap-2">
            {notifications.map((n) => (
                <Card key={n.id} className="p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                {n.title}
                            </div>
                            {n.body ? (
                                <div className="mt-1 text-sm text-gray-600 dark:text-gray-300 break-words">
                                    {n.body}
                                </div>
                            ) : null}
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => dismissNotification(n.id)}
                            className="h-8 w-8 shrink-0"
                            aria-label="Dismiss notification"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </Card>
            ))}
        </div>
    )
}
