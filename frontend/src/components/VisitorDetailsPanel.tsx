import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { 
  Mail, 
  Phone, 
  Monitor, 
  Chrome, 
  Plus,
  X
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"

interface VisitorDetailsPanelProps {
  conversation: {
    id: number
    session_id: string
    visitor_name?: string
    visitor_email?: string
    visitor_phone?: string
    device_info?: string
    browser_info?: string
    visit_count?: number
    last_seen_at?: string
    created_at?: string
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
}

export default function VisitorDetailsPanel({
  conversation,
  notes = [],
  onUpdateMetadata,
  onAddNote,
  onDeleteNote,
}: VisitorDetailsPanelProps) {
  const [editingEmail, setEditingEmail] = useState(false)
  const [editingPhone, setEditingPhone] = useState(false)
  const [email, setEmail] = useState(conversation.visitor_email || "")
  const [phone, setPhone] = useState(conversation.visitor_phone || "")

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

  const getInitials = (name?: string, sessionId?: string) => {
    if (name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    }
    if (sessionId) {
      return sessionId.substring(0, 2).toUpperCase()
    }
    return '??'
  }

  return (
    <div className="w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 overflow-y-auto flex-shrink-0">
      {/* Visitor Profile */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-col items-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white font-bold text-2xl shadow-lg mb-3">
            {getInitials(conversation.visitor_name, conversation.session_id)}
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            {conversation.visitor_name || conversation.session_id.substring(0, 8)}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {conversation.last_seen_at 
              ? `Last seen ${formatDistanceToNow(new Date(conversation.last_seen_at), { addSuffix: true })}`
              : 'Active now'}
          </p>

          {/* Stats */}
          <div className="flex gap-6 w-full justify-center">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {conversation.visit_count || 1}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Visits</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">1</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Chats</div>
            </div>
          </div>
        </div>
      </div>

      {/* Contact Information */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
        {/* Email */}
        <div className="flex items-start gap-2">
          <Mail className="h-4 w-4 text-gray-400 mt-2" />
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
        <div className="flex items-start gap-2">
          <Phone className="h-4 w-4 text-gray-400 mt-2" />
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

        {/* Device Info */}
        {conversation.device_info && (
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {conversation.device_info}
            </span>
          </div>
        )}

        {/* Browser Info */}
        {conversation.browser_info && (
          <div className="flex items-center gap-2">
            <Chrome className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {conversation.browser_info}
            </span>
          </div>
        )}
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

    </div>
  )
}
