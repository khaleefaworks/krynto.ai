import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  User,
  Mail,
  Phone,
  Monitor,
  Globe,
  Plus,
  X
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import UserAvatar from "@/components/UserAvatar"

function shortSessionId(sessionId: string | null | undefined): string {
  const raw = String(sessionId || "").trim()
  if (!raw) return ""
  const lastSegment = raw.split("-").filter(Boolean).pop() || raw
  if (lastSegment.length >= 12) return lastSegment.slice(-12)
  const compact = raw.replace(/-/g, "")
  return compact.length >= 12 ? compact.slice(-12) : raw
}

function visitorDisplayName(conv: { visitor_name?: string | null; title?: string | null; short_id?: string | null; session_id?: string | null }): string {
  const name = String(conv.visitor_name || '').trim()
  if (name) return name
  const title = String(conv.title || '').trim()
  if (title) return title
  const shortId = String(conv.short_id || '').trim()
  if (shortId) return shortId
  return shortSessionId(conv.session_id)
}

interface VisitorDetailsPanelProps {
  conversation: {
    id: number
    short_id?: string
    session_id: string
    visitor_name?: string
    visitor_email?: string
    visitor_phone?: string
    device_info?: string
    browser_info?: string
    visitor_ip?: string | null
    visit_count?: number
    last_seen_at?: string
    visitor_avatar_color?: string | null
    created_at?: string
    title?: string | null
  }
  notes?: Array<{
    id: number
    content: string
    created_at: string
    creator_name: string
  }>
  onUpdateMetadata?: (data: { visitor_name?: string; visitor_email?: string; visitor_phone?: string }) => void
  onAddNote?: (content: string) => void
  onDeleteNote?: (noteId: number) => void

  browsingHistory?: Array<{
    id: number
    title: string | null
    url: string
    referrer: string | null
    created_at: string
  }>

  rating?: { rating: number; feedback?: string } | null

  formSubmissions?: Array<{
    id: number
    form_id: number
    form_name: string | null
    form_fields: Array<{ name: string; label: string; type: string }>
    data: Record<string, string>
    created_at: string | null
  }>
}

export default function VisitorDetailsPanel({
  conversation,
  notes = [],
  onUpdateMetadata,
  onAddNote,
  onDeleteNote,
  browsingHistory = [],
  rating,
  formSubmissions = [],
}: VisitorDetailsPanelProps) {
  const [editingName, setEditingName] = useState(false)
  const [editingEmail, setEditingEmail] = useState(false)
  const [editingPhone, setEditingPhone] = useState(false)
  const [name, setName] = useState(conversation.visitor_name || "")
  const [email, setEmail] = useState(conversation.visitor_email || "")
  const [phone, setPhone] = useState(conversation.visitor_phone || "")

  // Keep local input state in sync when switching conversations
  useEffect(() => {
    setName(conversation.visitor_name || "")
    setEmail(conversation.visitor_email || "")
    setPhone(conversation.visitor_phone || "")
    setEditingName(false)
    setEditingEmail(false)
    setEditingPhone(false)
  }, [conversation.id])

  const saveName = () => {
    if (onUpdateMetadata) {
      onUpdateMetadata({ visitor_name: name })
    }
    setEditingName(false)
  }

  const [newNote, setNewNote] = useState("")
  const [addingNote, setAddingNote] = useState(false)

  const saveEmail = () => {
    if (onUpdateMetadata) {
      onUpdateMetadata({ visitor_email: email })
    }
    setEditingEmail(false)
  }

  const savePhone = () => {
    if (onUpdateMetadata) {
      onUpdateMetadata({ visitor_phone: phone })
    }
    setEditingPhone(false)
  }

  const handleAddNote = () => {
    if (newNote.trim() && onAddNote) {
      onAddNote(newNote.trim())
      setNewNote("")
      setAddingNote(false)
    }
  }

  const getVisitorAvatarSeed = (name?: string, sessionId?: string) => {
    const sid = String(sessionId || '').trim()
    if (sid) return sid
    const n = String(name || '').trim()
    return n || 'visitor'
  }

  return (
    <div className="w-full bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700">
      {/* Visitor Profile */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-col items-center">
          <UserAvatar
            seed={getVisitorAvatarSeed(conversation.visitor_name, conversation.session_id)}
            bgColor={conversation.visitor_avatar_color}
            className="w-16 h-16 shadow-lg mb-3"
            iconClassName="w-16 h-16"
            title={visitorDisplayName(conversation)}
          />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            {visitorDisplayName(conversation)}
          </h3>
        </div>
      </div>

      {/* IP / device rows — no heading, Smartsupp-style */}
      {(conversation.visitor_ip || conversation.device_info || conversation.browser_info) && (
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 space-y-1.5">
          {conversation.visitor_ip && (
            <div className="flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
              <span className="text-xs text-gray-600 dark:text-gray-400 font-mono">{conversation.visitor_ip}</span>
            </div>
          )}
          {(conversation.device_info || conversation.browser_info) && (
            <div className="flex items-center gap-2">
              <Monitor className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {[conversation.device_info, conversation.browser_info].filter(Boolean).join(', ')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Visitor Rating */}
      {rating && (
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Visitor Rating</h4>
          <div className="flex items-center gap-3">
            <span className="text-2xl">
              {rating.rating === 1 ? '😊' : rating.rating === 0 ? '😐' : '😞'}
            </span>
            <div>
              <span className={`text-sm font-medium ${rating.rating === 1 ? 'text-green-600 dark:text-green-400' :
                  rating.rating === 0 ? 'text-yellow-600 dark:text-yellow-400' :
                    'text-red-600 dark:text-red-400'
                }`}>
                {rating.rating === 1 ? 'Good' : rating.rating === 0 ? 'Neutral' : 'Bad'}
              </span>
              {rating.feedback && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{rating.feedback}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Contact Information */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
        {/* Name */}
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-gray-400" />
          <div className="flex-1">
            {editingName ? (
              <div className="flex gap-1">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Visitor name"
                  className="h-8 text-sm"
                  onBlur={saveName}
                  onKeyDown={(e) => e.key === 'Enter' && saveName()}
                  autoFocus
                />
              </div>
            ) : (
              <button
                onClick={() => setEditingName(true)}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-left w-full"
              >
                {name || "Fill in visitor's name"}
              </button>
            )}
          </div>
        </div>

        {/* Email */}
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-gray-400" />
          <div className="flex-1">
            {editingEmail ? (
              <div className="flex gap-1">
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="visitor@example.com"
                  className="h-8 text-sm"
                  onBlur={saveEmail}
                  onKeyDown={(e) => e.key === 'Enter' && saveEmail()}
                  autoFocus
                />
              </div>
            ) : (
              <button
                onClick={() => setEditingEmail(true)}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-left w-full"
              >
                {email || "Fill in visitor's email"}
              </button>
            )}
          </div>
        </div>

        {/* Phone */}
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-gray-400" />
          <div className="flex-1">
            {editingPhone ? (
              <div className="flex gap-1">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1234567890"
                  className="h-8 text-sm"
                  onBlur={savePhone}
                  onKeyDown={(e) => e.key === 'Enter' && savePhone()}
                  autoFocus
                />
              </div>
            ) : (
              <button
                onClick={() => setEditingPhone(true)}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-left w-full"
              >
                {phone || "Fill in visitor's phone number"}
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Private Notes */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
            Note (visible only to agents)
          </h4>
          {!addingNote && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAddingNote(true)}
              className="h-6 px-2"
            >
              <Plus className="h-3 w-3" />
            </Button>
          )}
        </div>

        {addingNote && (
          <div className="mb-3 space-y-2">
            <Textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a private note..."
              className="text-sm min-h-[60px]"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddNote} className="flex-1">
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAddingNote(false)
                  setNewNote("")
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {notes.length > 0 ? (
          <div className="space-y-2">
            {notes.map(note => (
              <div key={note.id} className="bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded text-sm border border-yellow-200 dark:border-yellow-800">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    {note.creator_name}
                  </span>
                  <button
                    onClick={() => onDeleteNote?.(note.id)}
                    className="text-gray-400 hover:text-red-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <p className="text-gray-800 dark:text-gray-200">{note.content}</p>
                <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 block">
                  {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          !addingNote && (
            <p className="text-sm text-gray-400 dark:text-gray-600 italic">
              No notes yet
            </p>
          )
        )}
      </div>

      {/* Browsing History */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
            Browsing history
          </h4>
        </div>
        {browsingHistory.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-600 italic">No browsing history yet</p>
        ) : (
          <div className="max-h-72 overflow-y-auto pr-2 space-y-3">
            {browsingHistory.map((item) => {
              const title = String(item.title || '').trim() || 'Document'
              const when = item.created_at ? formatDistanceToNow(new Date(item.created_at), { addSuffix: true }) : ''
              return (
                <div key={item.id} className="flex gap-3">
                  <div className="pt-1 flex flex-col items-center">
                    <div className="h-2.5 w-2.5 rounded-full bg-gray-400 dark:bg-gray-500" />
                    <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700 mt-1" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-sm text-gray-900 dark:text-white truncate">{title}</div>
                      {when && <div className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{when}</div>}
                    </div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all"
                    >
                      {item.url}
                    </a>
                    {item.referrer && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 break-all">
                        Referrer{' '}
                        <a
                          href={item.referrer}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {item.referrer}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Form Submissions */}
      {formSubmissions.length > 0 && (
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Form submissions</h4>
          </div>
          <div className="space-y-4">
            {formSubmissions.map((sub) => {
              const when = sub.created_at ? formatDistanceToNow(new Date(sub.created_at), { addSuffix: true }) : ''
              const labelMap: Record<string, string> = {}
              ;(sub.form_fields || []).forEach((f) => { labelMap[f.name] = f.label })
              return (
                <div key={sub.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{sub.form_name || 'Form'}</span>
                    {when && <span className="text-xs text-gray-400 dark:text-gray-500">{when}</span>}
                  </div>
                  {Object.entries(sub.data || {}).map(([key, val]) => (
                    <div key={key} className="text-xs">
                      <span className="text-gray-500 dark:text-gray-400">{labelMap[key] || key}: </span>
                      <span className="text-gray-900 dark:text-white">{String(val)}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}
