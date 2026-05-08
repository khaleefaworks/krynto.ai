import { HelpCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface DocsLinkProps {
  slug: string
  className?: string
  tooltip?: string
}

export default function DocsLink({ slug, className, tooltip = 'Help & Documentation' }: DocsLinkProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={`/docs/${slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors ${className || ''}`}
          >
            <HelpCircle className="w-4 h-4" />
          </Link>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
