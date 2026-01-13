import * as React from "react"
import { cn } from "@/lib/utils"

interface DropdownMenuProps {
  children: React.ReactNode
}

interface DropdownMenuTriggerProps {
  children: React.ReactNode
  asChild?: boolean
}

interface DropdownMenuContentProps {
  children: React.ReactNode
  align?: "start" | "center" | "end"
  className?: string
}

interface DropdownMenuItemProps {
  children: React.ReactNode
  onSelect?: () => void
  className?: string
}

interface DropdownMenuSeparatorProps {
  className?: string
}

const DropdownMenuContext = React.createContext<{
  isOpen: boolean
  setIsOpen: (open: boolean) => void
}>({
  isOpen: false,
  setIsOpen: () => {},
})

export function DropdownMenu({ children }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <DropdownMenuContext.Provider value={{ isOpen, setIsOpen }}>
      <div className="relative">{children}</div>
    </DropdownMenuContext.Provider>
  )
}

export function DropdownMenuTrigger({ children }: DropdownMenuTriggerProps) {
  const { isOpen, setIsOpen } = React.useContext(DropdownMenuContext)

  return (
    <div onClick={() => setIsOpen(!isOpen)}>
      {children}
    </div>
  )
}

export function DropdownMenuContent({ children, className }: DropdownMenuContentProps) {
  const { isOpen, setIsOpen } = React.useContext(DropdownMenuContext)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isOpen, setIsOpen])

  if (!isOpen) return null

  return (
    <div
      ref={ref}
      className={cn(
        "absolute bottom-full left-0 mb-2 z-50 min-w-[12rem] overflow-hidden rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 shadow-lg",
        className
      )}
    >
      {children}
    </div>
  )
}

export function DropdownMenuItem({ children, onSelect, className }: DropdownMenuItemProps) {
  const { setIsOpen } = React.useContext(DropdownMenuContext)

  const handleClick = () => {
    onSelect?.()
    setIsOpen(false)
  }

  return (
    <div
      onClick={handleClick}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 focus:bg-gray-100 dark:focus:bg-gray-700",
        className
      )}
    >
      {children}
    </div>
  )
}

export function DropdownMenuSeparator({ className }: DropdownMenuSeparatorProps) {
  return (
    <div
      className={cn(
        "my-1 h-px bg-gray-200 dark:bg-gray-700",
        className
      )}
    />
  )
}

export function DropdownMenuLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "px-2 py-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100",
        className
      )}
    >
      {children}
    </div>
  )
}
