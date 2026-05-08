import { cn } from '@/lib/utils'

const PALETTE = [
    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200',
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200',
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
    'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200',
    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200',
    'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200',
    'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-200',
    'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200',
] as const

function hashSeed(seed: string): number {
    const s = String(seed || '')
    let h = 2166136261
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return h >>> 0
}

export function getSeededAvatarPaletteClass(seed: string): string {
    const idx = hashSeed(seed) % PALETTE.length
    return PALETTE[idx] || PALETTE[PALETTE.length - 1]
}

export default function UserAvatar({
    seed,
    bgColor,
    imageUrl,
    className,
    iconClassName,
    title,
}: {
    seed: string
    bgColor?: string | null
    imageUrl?: string | null
    className?: string
    iconClassName?: string
    title?: string
}) {
    const palette = getSeededAvatarPaletteClass(seed)

    if (imageUrl) {
        return (
            <div
                className={cn('rounded-full overflow-hidden ring-1 ring-black/5 dark:ring-white/10', className)}
                title={title}
                aria-hidden="true"
            >
                <img src={imageUrl} alt={title || ''} className="w-full h-full object-cover" />
            </div>
        )
    }

    const useInlineColor = Boolean(bgColor && String(bgColor).trim())
    return (
        <div
            className={cn(
                'rounded-full overflow-auto flex items-center justify-center ring-1 ring-black/5 dark:ring-white/10',
                useInlineColor ? 'text-black' : palette,
                className
            )}
            style={useInlineColor ? { backgroundColor: String(bgColor) } : undefined}
            title={title}
            aria-hidden="true"
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="-20 -60 300 310"
                className={cn('w-5 h-5 opacity-40', iconClassName)}
                fill="currentColor"
                aria-hidden="true"
            >
                <path d="M206.8,192.2c-35.6-12.8-47-23.7-47-46.9c-0.1-2.1,0.3-4.1,1-6.1c2.8-7.2,10.8-8,14.6-28.8      c2-10.6,11.6-0.2,13.4-24.3c0-9.6-5.3-12-5.3-12s2.7-14.3,3.7-25.2c1.3-13.7-8-48.9-57.4-48.9h-1.3C79.3,0,69.9,35.3,71.3,48.9      c1,11,3.7,25.2,3.7,25.2s-5.3,2.4-5.3,12c1.8,24.1,11.4,13.7,13.4,24.3c3.9,20.8,11.8,21.6,14.6,28.8c0.7,2,1.1,4,1,6.1      c0,23.2-11.4,34-47,46.9S0,218.2,0,227.2V260l258.5,0.1v-32.9C258.5,218.2,242.5,205.1,206.8,192.2L206.8,192.2z" />
            </svg>
        </div>
    )
}
