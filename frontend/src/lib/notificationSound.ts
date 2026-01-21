let audioContext: AudioContext | null = null
let isArmed = false

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
export function playNotificationBeep(): void {
  const ctx = getAudioContext()
  if (!ctx) return

  const now = ctx.currentTime

  try {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, now)

    // Envelope to avoid click.
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)

    oscillator.connect(gain)
    gain.connect(ctx.destination)

    oscillator.start(now)
    oscillator.stop(now + 0.13)

    // Mark as armed once a sound successfully plays.
    isArmed = true
  } catch {
    // ignore
  }
}
