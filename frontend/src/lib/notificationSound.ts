let audioContext: AudioContext | null = null
let isArmed = false

const _audioBaseCache = new Map<string, HTMLAudioElement>()

// Fixed structure (no user settings):
// - New visitor (first message / new chat): /sounds/new-notification.mp3
// - Subsequent messages: /sounds/notification.mp3
export const NEW_VISITOR_SOUND_URL = '/sounds/new-notification.mp3'
export const MESSAGE_SOUND_URL = '/sounds/notification.mp3'

function _getOrCreateBaseAudio(url: string): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null
  if (!url) return null
  try {
    const existing = _audioBaseCache.get(url)
    if (existing) return existing

    const a = new Audio(url)
    a.preload = 'auto'
    _audioBaseCache.set(url, a)
    return a
  } catch {
    return null
  }
}

function _preloadKnownSounds(): void {
  try {
    const a1 = _getOrCreateBaseAudio(NEW_VISITOR_SOUND_URL)
    try { a1?.load() } catch { }
    const a2 = _getOrCreateBaseAudio(MESSAGE_SOUND_URL)
    try { a2?.load() } catch { }
  } catch {
    // ignore
  }
}

function _playFile(url: string): void {
  const base = _getOrCreateBaseAudio(url)
  if (!base) return
  try {
    // Clone so rapid/overlapping beeps still play.
    const a = base.cloneNode(true) as HTMLAudioElement
    a.preload = 'auto'
    a.currentTime = 0
    // Keep volume at 1.0 for now (OS / browser volume control is still respected).
    a.volume = 1.0
    void a.play()
  } catch {
    // ignore
  }
}

export type NotificationSoundKind = 'new_visitor' | 'message'

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null

  const AnyWindow: any = window as any
  const Ctor = (window.AudioContext || AnyWindow.webkitAudioContext) as
    | (new () => AudioContext)
    | undefined

  if (!Ctor) return null
  if (!audioContext) audioContext = new Ctor()
  return audioContext
}

async function armAudio(): Promise<void> {
  if (isArmed) return

  const ctx = getAudioContext()
  if (!ctx) return

  try {
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    // Play a near-silent, ultra-short buffer to satisfy browser gesture policies.
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.start(0)

    isArmed = true
  } catch {
    // ignore (browser policies / unavailable output)
  }
}

/**
 * Arms notification sounds on first user gesture.
 * Browsers generally require a user interaction before audio can play.
 */
export function installNotificationSoundArm(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (isArmed) return

  const once = () => {
    void armAudio()
    _preloadKnownSounds()
    cleanup()
  }

  const opts: AddEventListenerOptions = { capture: true, passive: true, once: true }

  const cleanup = () => {
    try { window.removeEventListener('pointerdown', once, true) } catch {}
    try { window.removeEventListener('keydown', once, true) } catch {}
    try { window.removeEventListener('touchstart', once, true) } catch {}
  }

  window.addEventListener('pointerdown', once, opts)
  window.addEventListener('keydown', once, opts)
  window.addEventListener('touchstart', once, opts)
}

/**
 * Plays a short notification beep in-app.
 * No-op if audio isn't available/armed.
 */
function _playNotificationSound(kind: NotificationSoundKind): void {
  const url = kind === 'new_visitor' ? NEW_VISITOR_SOUND_URL : MESSAGE_SOUND_URL

  // 1) Prefer file-based sounds.
  try {
    _playFile(url)
    isArmed = true
    return
  } catch {
    // fall back
  }

  // 2) Fallback to synthesized tone so notifications still work even
  //    if the sound file is missing/misconfigured.
  const ctx = getAudioContext()
  if (!ctx) return

  const now = ctx.currentTime

  try {
    const playTone = (opts: {
      start: number
      duration: number
      frequency: number
      type: OscillatorType
      peakGain: number
      endGain?: number
      frequencyEnd?: number
    }) => {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()

      oscillator.type = opts.type
      oscillator.frequency.setValueAtTime(opts.frequency, opts.start)
      if (typeof opts.frequencyEnd === 'number') {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, opts.frequencyEnd), opts.start + opts.duration)
      }

      const endGain = typeof opts.endGain === 'number' ? opts.endGain : 0.0001

      // Envelope to avoid click.
      gain.gain.setValueAtTime(0.0001, opts.start)
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.peakGain), opts.start + Math.min(0.01, opts.duration / 2))
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, endGain), opts.start + Math.max(0.02, opts.duration))

      oscillator.connect(gain)
      gain.connect(ctx.destination)

      oscillator.start(opts.start)
      oscillator.stop(opts.start + opts.duration + 0.02)
    }

    if (kind === 'new_visitor') {
      playTone({ start: now, duration: 0.14, frequency: 988, type: 'square', peakGain: 0.22 })
    } else {
      playTone({ start: now, duration: 0.13, frequency: 880, type: 'sine', peakGain: 0.12 })
    }

    // Mark as armed once a sound successfully plays.
    isArmed = true
  } catch {
    // ignore
  }
}

// Backward-compatible name used across the app (treated as normal message sound).
export function playNotificationBeep(): void {
  _playNotificationSound('message')
}

export function playNewVisitorNotificationSound(): void {
  _playNotificationSound('new_visitor')
}

export function playMessageNotificationSound(): void {
  _playNotificationSound('message')
}
