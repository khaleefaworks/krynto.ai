import { useState, useEffect } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Menu, X, Moon, Sun, Search } from 'lucide-react'
import Logo from '../components/Logo'
import { docsNav } from '../config/docsNav'

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('docs_dark_mode')
    if (stored !== null) return stored === 'true'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    const root = document.documentElement
    if (dark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('docs_dark_mode', String(dark))
  }, [dark])

  return [dark, setDark] as const
}

export default function DocsLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [dark, setDark] = useDarkMode()
  const location = useLocation()
  const navigate = useNavigate()

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  // Redirect /docs → /docs/getting-started/introduction
  useEffect(() => {
    if (location.pathname === '/docs' || location.pathname === '/docs/') {
      navigate('/docs/getting-started/introduction', { replace: true })
    }
  }, [location.pathname, navigate])

  const currentSlug = location.pathname.replace('/docs/', '')

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-950/95 backdrop-blur">
        <div className="flex items-center gap-3 h-14 px-4 max-w-screen-xl mx-auto">
          {/* Mobile sidebar toggle */}
          <button
            className="lg:hidden p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          {/* Logo + brand */}
          <Link to="/docs/getting-started/introduction" className="flex items-center gap-2 shrink-0">
            <Logo size={26} />
            <span className="font-semibold text-sm hidden sm:block">AI ChatAssist</span>
            <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block mt-0.5">Docs</span>
          </Link>

          <div className="flex-1" />

          {/* Dark mode toggle */}
          <button
            onClick={() => setDark(!dark)}
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
            aria-label="Toggle dark mode"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Dashboard link */}
          <Link
            to="/dashboard/chats"
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors"
          >
            Go to Dashboard
          </Link>
        </div>
      </header>

      <div className="max-w-screen-xl mx-auto flex">
        {/* Sidebar overlay (mobile) */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`
            fixed top-14 bottom-0 left-0 z-30 w-64 overflow-y-auto
            bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800
            transition-transform duration-200
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            lg:sticky lg:translate-x-0 lg:h-[calc(100vh-3.5rem)]
          `}
        >
          <nav className="p-4 space-y-6">
            {docsNav.map((section) => (
              <div key={section.slug}>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-2">
                  {section.title}
                </p>
                <ul className="space-y-0.5">
                  {section.pages.map((page) => {
                    const isActive = currentSlug === page.slug
                    return (
                      <li key={page.slug}>
                        <Link
                          to={`/docs/${page.slug}`}
                          className={`
                            block px-2 py-1.5 rounded-md text-sm transition-colors
                            ${isActive
                              ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-medium'
                              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                            }
                          `}
                        >
                          {page.title}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 lg:pl-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
