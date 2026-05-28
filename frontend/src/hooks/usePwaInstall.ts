import { useState, useEffect } from 'react'

interface UsePwaInstall {
  isInstallable: boolean
  install: () => Promise<void>
}

export function usePwaInstall(): UsePwaInstall {
  const [prompt, setPrompt] = useState<any>(null)

  useEffect(() => {
    // Already running as installed PWA — no install button needed.
    if (window.matchMedia('(display-mode: standalone)').matches) return

    const handler = (e: Event) => {
      e.preventDefault()
      setPrompt(e)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const install = async () => {
    if (!prompt) return
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setPrompt(null)
  }

  return { isInstallable: prompt !== null, install }
}
