import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Best-effort: do not block app startup.
    })

    // When a new SW takes over mid-session (skipWaiting + clients.claim),
    // the browser may silently invalidate the existing push subscription.
    // Re-subscribe immediately so push delivery isn't interrupted.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      import('./services/push').then(({ ensurePushSubscription }) => {
        ensurePushSubscription().catch(() => {})
      }).catch(() => {})
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
