import { useState, useEffect } from 'react'

interface UsePwaInstall {
  isInstallable: boolean
  install: () => Promise<void>
}

export function usePwaInstall(): UsePwaInstall {
  const [prompt, setPrompt] = useState<any>(() => {
    // beforeinstallprompt may have already fired before React mounted
    if (typeof window !== 'undefined' && (window as any).__pwaInstallPrompt) {
      return (window as any).__pwaInstallPrompt
    }
    return null
  })

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return

    const onReady = () => {
      setPrompt((window as any).__pwaInstallPrompt ?? null)
    }

    window.addEventListener('pwainstallready', onReady)
    return () => window.removeEventListener('pwainstallready', onReady)
  }, [])

  const install = async () => {
    if (!prompt) return
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') {
      setPrompt(null)
      delete (window as any).__pwaInstallPrompt
    }
  }

  return { isInstallable: prompt !== null, install }
}
