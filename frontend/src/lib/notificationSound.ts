let audioContext: AudioContext | null = null
let isArmed = false

// localStorage keys for user-configurable notification sounds
export const SOUND_PREF_KEYS = {
  newChat: 'notif_sound_new_chat',
  message: 'notif_sound_message',
  newVisitorWebsite: 'notif_sound_new_visitor_website',
  sinkId: 'notif_sound_sink_id',
} as const

/**
 * Triggers a dummy getUserMedia call to unlock hardware device labels.
 * Browsers protect hardware info (like speaker names) until the user grants 
 * a media permission.
 */
export async function ensureHardwareLabelsUnlocked(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return
  
  try {
    // Only trigger if we don't already have labels
    const devices = await navigator.mediaDevices.enumerateDevices()
    const hasLabels = devices.some(d => !!d.label)
    if (hasLabels) return

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach(t => t.stop())
  } catch (err) {
    console.warn('Failed to unlock hardware labels:', err)
  }
}

// Default sound file names (relative to /sounds/)
const SOUND_DEFAULTS = {
  newChat: 'alarm.mp3',
  message: 'blackberry2.mp3',
  newVisitorWebsite: 'simplesms.mp3',
}

// Kept for backward-compat (used by components that reference these constants directly)
export const NEW_VISITOR_SOUND_URL = '/sounds/alarm.mp3'
export const MESSAGE_SOUND_URL = '/sounds/blackberry2.mp3'

/** Returns the configured sound URL for a given key, or '' if silent. */
function _getSoundUrl(key: keyof typeof SOUND_PREF_KEYS): string {
  try {
    const stored = localStorage.getItem(SOUND_PREF_KEYS[key])
    // null means never set → use default; empty string means user chose silent
    const fileName = stored !== null ? stored : (SOUND_DEFAULTS as any)[key]
    return fileName ? `/sounds/${fileName}` : ''
  } catch {
    return (SOUND_DEFAULTS as any)[key] ? `/sounds/${(SOUND_DEFAULTS as any)[key]}` : ''
  }
}

/** 
 * Helper to get the effective sinkId for the browser API.
 * The spec uses "" for default, but we store "default" for clarity in settings.
 */
function _getEffectiveSinkId(): string {
  try {
    const saved = localStorage.getItem(SOUND_PREF_KEYS.sinkId)
    if (!saved || saved === 'default') return ''
    return saved
  } catch {
    return ''
  }
}


/**
 * Updates the output device for future notification sounds.
 * @param sinkId The device ID from navigator.mediaDevices.enumerateDevices()
 */
export async function setNotificationAudioSink(sinkId: string): Promise<void> {
  try {
    localStorage.setItem(SOUND_PREF_KEYS.sinkId, sinkId)
    const effectiveSinkId = sinkId === 'default' ? '' : sinkId

    // Update AudioContext
    const ctx = getAudioContext()
    if (ctx && typeof (ctx as any).setSinkId === 'function') {
      try { await (ctx as any).setSinkId(effectiveSinkId) } catch { }
    }
  } catch {
    // ignore
  }
}

/**
 * Resumes a suspended AudioContext if needed.
 * AudioContext can be suspended by the browser in background tabs after inactivity.
 * Call this before playing a sound when the tab may have been idle for a while.
 */
export async function resumeAudioContextIfSuspended(): Promise<void> {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') {
    try { await ctx.resume() } catch { }
  }
}

function _preloadKnownSounds(): void {
  try {
    const urls = [
      _getSoundUrl('newChat'),
      _getSoundUrl('message'),
      _getSoundUrl('newVisitorWebsite'),
    ].filter(Boolean)
    for (const url of urls) {
      try {
        const a = new Audio(url)
        a.preload = 'auto'
        a.load()
      } catch { }
    }
  } catch {
    // ignore
  }
}

function _playFile(url: string): void {
  if (typeof window === 'undefined' || !url) return
  try {
    // Create a fresh Audio each time — cloneNode(true) does not reliably copy
    // the decoded audio source across browsers, especially in background tabs.
    const a = new Audio(url)
    a.volume = 1.0

    const sinkId = _getEffectiveSinkId()
    if (typeof (a as any).setSinkId === 'function') {
      ;(a as any).setSinkId(sinkId).catch(() => {})
    }

    // Properly handle autoplay rejection (browser policy in inactive tabs).
    a.play().catch(() => {})
  } catch {
    // ignore
  }
}

export type NotificationSoundKind = 'new_visitor' | 'message' | 'new_visitor_website'

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null

  const AnyWindow: any = window as any
  const Ctor = (window.AudioContext || AnyWindow.webkitAudioContext) as
    | (new () => AudioContext)
    | undefined

  if (!Ctor) return null
  if (!audioContext) {
    audioContext = new Ctor()
    // Apply sinkId to new context if configured
    const sinkId = _getEffectiveSinkId()
    if (typeof (audioContext as any).setSinkId === 'function') {
      (audioContext as any).setSinkId(sinkId).catch(() => {})
    }
  }
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
    try { window.removeEventListener('pointerdown', once, true) } catch { }
    try { window.removeEventListener('keydown', once, true) } catch { }
    try { window.removeEventListener('touchstart', once, true) } catch { }
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
  const url = kind === 'new_visitor'
    ? _getSoundUrl('newChat')
    : kind === 'new_visitor_website'
      ? _getSoundUrl('newVisitorWebsite')
      : _getSoundUrl('message')

  // 1) Prefer file-based sounds. Empty URL means user chose silent.
  if (!url) return
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
    } else if (kind === 'new_visitor_website') {
      playTone({ start: now, duration: 0.14, frequency: 880, type: 'square', peakGain: 0.18 })
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

/** Plays the 'New chat' sound (configurable, plays from any dashboard page). */
export function playNewVisitorNotificationSound(): void {
  _playNotificationSound('new_visitor')
}

/** Plays the 'New message' sound (configurable). */
export function playMessageNotificationSound(): void {
  _playNotificationSound('message')
}

/**
 * Plays the 'New visitor on website' sound.
 * This should only be called when the agent is on the Customers → Visitors tab.
 */
export function playNewVisitorOnWebsiteSound(): void {
  _playNotificationSound('new_visitor_website')
}
