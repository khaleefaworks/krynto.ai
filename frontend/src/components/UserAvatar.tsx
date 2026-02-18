import { UserRound } from 'lucide-react'
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
  className,
  iconClassName,
  title,
}: {
  seed: string
  className?: string
  iconClassName?: string
  title?: string
}) {
  const palette = getSeededAvatarPaletteClass(seed)
  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center ring-1 ring-black/5 dark:ring-white/10',
        palette,
        className
      )}
      title={title}
      aria-hidden="true"
    >
      <UserRound className={cn('w-5 h-5', iconClassName)} />
    </div>
  )
}
