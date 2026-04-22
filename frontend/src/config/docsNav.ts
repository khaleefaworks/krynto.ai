// Navigation config for the /docs portal.
// Each section has a title and a list of pages.
// slug must match the file path under docs-content/ (without .md).

export interface DocPage {
  title: string
  slug: string
}

export interface DocSection {
  title: string
  slug: string
  pages: DocPage[]
}

export const docsNav: DocSection[] = [
  {
    title: 'Getting Started',
    slug: 'getting-started',
    pages: [
      { title: 'Introduction', slug: 'getting-started/introduction' },
      { title: 'Quick Start', slug: 'getting-started/quick-start' },
      { title: 'Installation', slug: 'getting-started/installation' },
    ],
  },
  {
    title: 'Agent Guide',
    slug: 'agent-guide',
    pages: [
      { title: 'Conversations', slug: 'agent-guide/conversations' },
      { title: 'Notifications', slug: 'agent-guide/notifications' },
      { title: 'Visitors & Contacts', slug: 'agent-guide/visitors' },
    ],
  },
  {
    title: 'Admin Guide',
    slug: 'admin-guide',
    pages: [
      { title: 'Websites', slug: 'admin-guide/websites' },
      { title: 'Agents & Roles', slug: 'admin-guide/agents' },
      { title: 'Teams', slug: 'admin-guide/teams' },
      { title: 'Automations', slug: 'admin-guide/automations' },
    ],
  },
  {
    title: 'Widget',
    slug: 'widget',
    pages: [
      { title: 'Embedding the Widget', slug: 'widget/embedding' },
      { title: 'Customisation', slug: 'widget/customisation' },
    ],
  },
  {
    title: 'API Reference',
    slug: 'api-reference',
    pages: [
      { title: 'Overview', slug: 'api-reference/overview' },
    ],
  },
]

// Helper: resolve the first page of a section (used for section-level links)
export function firstPage(section: DocSection): DocPage {
  return section.pages[0]
}

// Helper: find a page by slug
export function findPage(slug: string): { section: DocSection; page: DocPage } | null {
  for (const section of docsNav) {
    const page = section.pages.find((p) => p.slug === slug)
    if (page) return { section, page }
  }
  return null
}

// Helper: get prev/next page for navigation
export function getAdjacentPages(slug: string): { prev: DocPage | null; next: DocPage | null } {
  const allPages = docsNav.flatMap((s) => s.pages)
  const idx = allPages.findIndex((p) => p.slug === slug)
  return {
    prev: idx > 0 ? allPages[idx - 1] : null,
    next: idx < allPages.length - 1 ? allPages[idx + 1] : null,
  }
}
