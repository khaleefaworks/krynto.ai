import { useEffect, useState, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Monitor,
  Globe,
  Plus,
  X,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  ClipboardList,
  ChevronRight,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { isValidPhoneNumber } from "libphonenumber-js"
import UserAvatar from "@/components/UserAvatar"
import BotAvatarIcon from "@/components/BotAvatarIcon"
import PhoneNumberField from "@/components/PhoneNumberField"
import { API_BASE } from "@/config/endpoints"
import { leadsApi, type LeadStatusResponse, type LeadDelivery } from "@/services/leads"
import { updateFormSubmission } from "@/services/chats"
import { cn } from "@/lib/utils"

// Same rule the backend enforces for an email-typed field (backend/app/repos/forms.py's
// EMAIL_RE) — mirrored here so an invalid address is flagged before the
// agent even hits Save, not just after a round trip to the server.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isValidEmailValue(value: string): boolean {
  return !value.trim() || EMAIL_RE.test(value.trim())
}
// Bare digits with no country context are assumed Indian, same as the
// backend (DEFAULT_PHONE_REGION) and the widget (DEFAULT_PHONE_COUNTRY) —
// see PhoneNumberField, which composes values this way too.
function isValidPhoneValue(value: string): boolean {
  const v = value.trim()
  if (!v) return true
  return v.startsWith('+') ? isValidPhoneNumber(v) : isValidPhoneNumber(v, 'IN')
}
function fieldMetaFor(sub: { form_fields?: Array<{ name?: string; field_name?: string; label?: string; type?: string; field_type?: string }> }): Record<string, { label: string; type: string }> {
  const meta: Record<string, { label: string; type: string }> = {}
  ;(sub.form_fields || []).forEach((f) => {
    const key = f?.name || f?.field_name
    if (key) meta[key] = { label: f?.label || key, type: f?.field_type || f?.type || 'text' }
  })
  return meta
}

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

const LEAD_STATUS_META: Record<string, { label: string; className: string }> = {
  not_sent: { label: 'Not sent', className: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
  pending: { label: 'Pending', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' },
  sent: { label: 'Sent', className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  partial: { label: 'Partially sent', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  awaiting_confirmation: { label: 'Needs review', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
}

interface FormSubmission {
  id: number
  form_id: number
  form_name: string | null
  form_fields: Array<{
    name?: string
    field_name?: string
    label?: string
    type?: string
    field_type?: string
  }>
  is_contact_card: boolean
  data: Record<string, string>
  created_at: string | null
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
    bot_only?: boolean
    assigned_agent_id?: number | null
    assigned_agent?: { id: number; name: string | null; avatar_url: string | null } | null
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

  formSubmissions?: FormSubmission[]
  // Called after the merged Form Submissions modal saves an edit to
  // one submission, with its full post-edit data — lets the parent patch
  // its own formSubmissions list in place (the panel's own edit buffer
  // resets once the modal closes, so without this a reopen shows stale
  // values again until the next full conversation-detail fetch).
  onFormSubmissionUpdated?: (submissionId: number, data: Record<string, string>) => void
  // Called when the modal opens, so the parent can refetch the list fresh
  // rather than showing whatever was loaded when the conversation was
  // first opened (which could be stale by the time an agent opens the
  // modal minutes later).
  onRequestFormSubmissionsRefresh?: () => void
  // Called after an edit to the contact-card submission, with the
  // visitor_name/email/phone the backend just synced onto the conversation
  // as a side effect — lets the parent patch its own conversation/chat-list
  // state so it doesn't silently drift from what this panel just saved.
  onConversationContactSynced?: (data: { visitor_name?: string | null; visitor_email?: string | null; visitor_phone?: string | null }) => void

  // Bumped by the parent on a lead_delivery_updated WS event so the Lead
  // delivery section below refetches without waiting for a reload.
  leadStatusRefreshKey?: number
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
  onFormSubmissionUpdated,
  onRequestFormSubmissionsRefresh,
  onConversationContactSynced,
  leadStatusRefreshKey,
}: VisitorDetailsPanelProps) {
  const [newNote, setNewNote] = useState("")
  const [addingNote, setAddingNote] = useState(false)

  const [leadStatus, setLeadStatus] = useState<LeadStatusResponse | null>(null)

  // Guards against an in-flight request for a previously-open conversation
  // resolving AFTER the request for whatever conversation is open now (e.g.
  // an agent clicking through the inbox quickly) and clobbering the current
  // one's correct state with a stale, unrelated result — same pattern as
  // loadMessagesTokenRef/loadDetailsTokenRef elsewhere in ConversationsView.
  const leadStatusTokenRef = useRef(0)
  const leadStatusConvIdRef = useRef<number | null>(null)

  const refreshLeadStatus = useCallback(() => {
    const token = ++leadStatusTokenRef.current
    const forId = conversation.id
    leadsApi.getStatus(forId)
      .then((status) => {
        if (leadStatusTokenRef.current === token) setLeadStatus(status)
      })
      .catch(() => {
        if (leadStatusTokenRef.current === token) setLeadStatus(null)
      })
  }, [conversation.id])

  useEffect(() => {
    // Only blank the section on an actual conversation switch — a WS-driven
    // refresh of the same conversation should update in place, not flicker.
    if (leadStatusConvIdRef.current !== conversation.id) {
      leadStatusConvIdRef.current = conversation.id
      setLeadStatus(null)
    }
    refreshLeadStatus()
  }, [conversation.id, refreshLeadStatus, leadStatusRefreshKey])

  // ── Form Submissions — merged modal ──────────────────────────────
  // Every form this visitor has submitted (contact card included, pinned
  // first) plus what happened when captured leads were sent, in one place
  // instead of three separate sections/popups.
  const [showFormsModal, setShowFormsModal] = useState(false)
  // `save` | `confirm:{deliveryId}` | `discard:{deliveryId}` | `resend:{deliveryId}` | null
  const [modalBusy, setModalBusy] = useState<string | null>(null)
  // Local edit buffer for every submitted form, keyed by submission id
  // (contact-card submission included) — undefined field means "use the
  // submission's current value".
  const [formEdits, setFormEdits] = useState<Record<number, Record<string, string>>>({})
  // Only used when there's no contact-card submission yet (e.g. a name an
  // agent typed in from chat, or an "offline gate" capture, neither of
  // which creates a WebsiteFormSubmission row) — bound straight to
  // conversation.visitor_name/email/phone instead of a submission.
  const [contactFallbackEdits, setContactFallbackEdits] = useState<{ name?: string; email?: string; phone?: string }>({})
  // Whatever the last save/confirm/discard/resend action failed with —
  // cleared on open/close and on the next attempt, shown as a banner so a
  // 422 (invalid email/phone, missing required field, ...) doesn't just
  // silently leave the edit sitting in the buffer with no explanation.
  const [modalError, setModalError] = useState<string | null>(null)

  // Multiple fills of the same form (an agent resending a contact card, a
  // visitor correcting themselves, a stray resubmit) create one
  // WebsiteFormSubmission row per fill — oldest first, per the backend's
  // get_submissions_by_conversation. Only the latest fill of any given form
  // reflects reality, so this collapses to one submission per form_id
  // (later entries overwrite earlier ones in the Map, since the source
  // array is oldest-first) — both which submission is shown/edited and how
  // many are counted below. Older fills of the same form aren't lost (still
  // in the DB, still in the raw formSubmissions prop) — just superseded,
  // the same way conversation.visitor_* already treats a second contact-card
  // fill as last-write-wins rather than a second fact.
  const latestSubmissionsByForm = Array.from(
    formSubmissions.reduce((byForm, s) => byForm.set(s.form_id, s), new Map<number, FormSubmission>()).values()
  )
  const contactSubmission = latestSubmissionsByForm.find((s) => s.is_contact_card) ?? null
  const otherSubmissions = latestSubmissionsByForm.filter((s) => !s.is_contact_card)
  const isFormsModalDirty =
    Object.keys(contactFallbackEdits).length > 0 ||
    Object.values(formEdits).some((edits) => Object.keys(edits || {}).length > 0)
  const hasAwaitingConfirmation = !!leadStatus?.deliveries.some((d) => d.status === 'awaiting_confirmation')

  // Client-side mirror of the backend's per-field format checks (email/phone
  // — see forms_repo.validate_contact_field) so an obviously-bad value is
  // caught before a round trip, not just after a 422 comes back.
  const hasValidationErrors = (() => {
    const checkSubmission = (sub: FormSubmission) => {
      const meta = fieldMetaFor(sub)
      return Object.entries(sub.data || {}).some(([key, val]) => {
        const current = formEdits[sub.id]?.[key] ?? String(val)
        const type = meta[key]?.type
        if (type === 'email') return !isValidEmailValue(current)
        if (type === 'phone') return !isValidPhoneValue(current)
        return false
      })
    }
    if (contactSubmission) {
      if (checkSubmission(contactSubmission)) return true
    } else {
      const email = contactFallbackEdits.email ?? conversation.visitor_email ?? ''
      const phone = contactFallbackEdits.phone ?? conversation.visitor_phone ?? ''
      if (!isValidEmailValue(email) || !isValidPhoneValue(phone)) return true
    }
    return otherSubmissions.some(checkSubmission)
  })()

  const openFormsModal = () => {
    setShowFormsModal(true)
    setModalError(null)
    refreshLeadStatus()
    onRequestFormSubmissionsRefresh?.()
  }

  const closeFormsModal = () => {
    if (modalBusy) return
    setShowFormsModal(false)
    setFormEdits({})
    setContactFallbackEdits({})
    setModalError(null)
  }

  // Persists every pending edit (contact info + every other touched form)
  // and returns the resulting name/email/phone, so a caller about to send
  // a lead can pass them straight through without waiting on the
  // conversation prop to re-render with the just-synced values.
  const persistPendingEdits = async (): Promise<{ name: string | null; email: string | null; phone: string | null }> => {
    let name = conversation.visitor_name ?? null
    let email = conversation.visitor_email ?? null
    let phone = conversation.visitor_phone ?? null

    if (contactSubmission) {
      const edits = formEdits[contactSubmission.id]
      if (edits && Object.keys(edits).length > 0) {
        const updated = await updateFormSubmission(conversation.id, contactSubmission.id, edits)
        onFormSubmissionUpdated?.(contactSubmission.id, updated.data)
        if (updated.conversation) {
          name = updated.conversation.visitor_name
          email = updated.conversation.visitor_email
          phone = updated.conversation.visitor_phone
          onConversationContactSynced?.(updated.conversation)
        }
      }
    } else if (Object.keys(contactFallbackEdits).length > 0) {
      name = contactFallbackEdits.name ?? name
      email = contactFallbackEdits.email ?? email
      phone = contactFallbackEdits.phone ?? phone
      await onUpdateMetadata?.({
        visitor_name: contactFallbackEdits.name,
        visitor_email: contactFallbackEdits.email,
        visitor_phone: contactFallbackEdits.phone,
      })
    }

    const otherIds = Object.keys(formEdits)
      .map(Number)
      .filter((id) => id !== contactSubmission?.id && Object.keys(formEdits[id] || {}).length > 0)
    for (const id of otherIds) {
      const updated = await updateFormSubmission(conversation.id, id, formEdits[id])
      onFormSubmissionUpdated?.(id, updated.data)
    }

    setFormEdits({})
    setContactFallbackEdits({})
    return { name, email, phone }
  }

  const handleSaveAll = async () => {
    setModalBusy('save')
    setModalError(null)
    try {
      await persistPendingEdits()
      refreshLeadStatus()
    } catch (e) {
      // Edits stay in the buffers so the agent can fix and retry.
      setModalError(e instanceof Error ? e.message : 'Failed to save changes')
    } finally {
      setModalBusy(null)
    }
  }

  const handleConfirmDelivery = async (delivery: LeadDelivery) => {
    setModalBusy(`confirm:${delivery.id}`)
    setModalError(null)
    try {
      const { name, email, phone } = await persistPendingEdits()
      await leadsApi.confirmDelivery(conversation.id, delivery.id, { name, email, phone })
      refreshLeadStatus()
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Failed to confirm this lead')
    } finally {
      setModalBusy(null)
    }
  }

  const handleDiscardDelivery = async (deliveryId: number) => {
    if (!window.confirm("Discard this lead without sending it? This can't be undone.")) return
    setModalBusy(`discard:${deliveryId}`)
    setModalError(null)
    try {
      await leadsApi.discardDelivery(conversation.id, deliveryId)
      refreshLeadStatus()
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Failed to discard this lead')
    } finally {
      setModalBusy(null)
    }
  }

  const handleResendDelivery = async (deliveryId: number) => {
    if (!window.confirm(
      "This will send the lead to this integration again right now. If it already went through, the receiving system may end up with a duplicate lead. Continue?"
    )) return
    setModalBusy(`resend:${deliveryId}`)
    setModalError(null)
    try {
      await leadsApi.resendDelivery(conversation.id, deliveryId)
      refreshLeadStatus()
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Failed to resend this lead')
    } finally {
      setModalBusy(null)
    }
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

  const renderFormCard = (sub: FormSubmission) => {
    const when = sub.created_at ? formatDistanceToNow(new Date(sub.created_at), { addSuffix: true }) : ''
    const fieldMeta = fieldMetaFor(sub)
    return (
      <div key={sub.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{sub.form_name || 'Form'}</span>
          {when && <span className="text-xs text-gray-400 dark:text-gray-500">{when}</span>}
        </div>
        {Object.entries(sub.data || {}).map(([key, val]) => {
          const meta = fieldMeta[key]
          const type = meta?.type || 'text'
          const currentValue = formEdits[sub.id]?.[key] ?? String(val)
          const setValue = (nextValue: string) => {
            setFormEdits((prev) => ({
              ...prev,
              [sub.id]: { ...prev[sub.id], [key]: nextValue },
            }))
          }
          const emailInvalid = type === 'email' && !isValidEmailValue(currentValue)
          return (
            <div key={key}>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">
                {meta?.label || key}
              </label>
              {type === 'phone' ? (
                <PhoneNumberField value={currentValue} onChange={setValue} />
              ) : (
                <>
                  <Input
                    type={type === 'email' ? 'email' : 'text'}
                    value={currentValue}
                    onChange={(e) => setValue(e.target.value)}
                    className={cn('text-sm', emailInvalid && 'border-red-500 focus-visible:ring-red-500')}
                  />
                  {emailInvalid && <p className="text-xs text-red-500 mt-1">Please enter a valid email address.</p>}
                </>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="w-full bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700">
      {/* Visitor Profile */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-col items-center">
          <div className="relative mb-3">
            <UserAvatar
              seed={getVisitorAvatarSeed(conversation.visitor_name, conversation.session_id)}
              bgColor={conversation.visitor_avatar_color}
              className="w-16 h-16 shadow-lg"
              iconClassName="w-16 h-16"
              title={visitorDisplayName(conversation)}
            />
            {conversation.assigned_agent_id ? (
              <div
                className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 border-white dark:border-gray-800 bg-gray-300 dark:bg-gray-600 flex items-center justify-center overflow-hidden"
                title={conversation.assigned_agent?.name || `Agent #${conversation.assigned_agent_id}`}
              >
                <UserAvatar
                  seed={String(conversation.assigned_agent_id)}
                  imageUrl={conversation.assigned_agent?.avatar_url
                    ? (String(conversation.assigned_agent.avatar_url).startsWith('http')
                      ? conversation.assigned_agent.avatar_url
                      : `${API_BASE}${conversation.assigned_agent.avatar_url}`)
                    : null}
                  className="w-5 h-5"
                  iconClassName="w-5 h-5"
                  title={conversation.assigned_agent?.name ?? undefined}
                />
              </div>
            ) : conversation.bot_only ? (
              <div
                className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 border-white dark:border-gray-800 bg-gray-100 dark:bg-gray-700 flex items-center justify-center overflow-hidden"
                title="Handled by bot"
              >
                <BotAvatarIcon className="w-4.5 h-4.5" />
              </div>
            ) : null}
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            {visitorDisplayName(conversation)}
          </h3>
        </div>
      </div>

      {/* Device info */}
      {(conversation.visitor_ip || conversation.device_info || conversation.browser_info) && (
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 space-y-1.5">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Device info</h4>
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

      {/* Form Submissions — single trigger for the merged modal below. */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={openFormsModal}
          className={`w-full flex items-center justify-between gap-2 rounded-md px-2 py-2 -mx-2 transition-colors ${hasAwaitingConfirmation
              ? 'bg-blue-50/60 dark:bg-blue-900/10 hover:bg-blue-50 dark:hover:bg-blue-900/20'
              : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
            }`}
        >
          <div className="flex items-center gap-2 text-left min-w-0">
            <ClipboardList className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">Forms Submissions</div>
              <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                {visitorDisplayName(conversation)}
                {latestSubmissionsByForm.length > 0 && ` · ${latestSubmissionsByForm.length} submission${latestSubmissionsByForm.length > 1 ? 's' : ''}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {leadStatus && leadStatus.has_integrations && leadStatus.status !== 'not_sent' && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LEAD_STATUS_META[leadStatus.status]?.className || ''}`}>
                {LEAD_STATUS_META[leadStatus.status]?.label || leadStatus.status}
              </span>
            )}
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </div>
        </button>
      </div>

      {showFormsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={closeFormsModal}
          />
          <div className="relative z-[60] w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Forms Submissions</h3>
                <button
                  onClick={closeFormsModal}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4 overflow-y-auto">
                {/* Per-integration delivery status, with inline actions for
                    whatever's still awaiting confirmation — no second popup. */}
                {!leadStatus ? null : !leadStatus.has_integrations ? (
                  <p className="text-xs text-gray-400 dark:text-gray-600 italic">No integrations configured for this website</p>
                ) : leadStatus.deliveries.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-600 italic">No lead sent yet</p>
                ) : (
                  <div className="space-y-2">
                    {leadStatus.deliveries.map((d) => (
                      <div
                        key={d.id}
                        className={`rounded-lg border p-3 ${d.status === 'awaiting_confirmation'
                            ? 'border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/10'
                            : 'border-gray-200 dark:border-gray-700'
                          }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                            {d.integration_name || `Integration #${d.integration_id}`}
                          </span>
                          {d.status === 'awaiting_confirmation' ? (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 flex-shrink-0">
                              Needs review
                            </span>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {d.status === 'sent' ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                              ) : d.status === 'failed' ? (
                                <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                              ) : d.status === 'cancelled' ? (
                                <X className="h-3.5 w-3.5 text-gray-400" />
                              ) : (
                                <span className="h-3.5 w-3.5 rounded-full border-2 border-yellow-400 border-t-transparent" />
                              )}
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {d.status === 'sent' ? 'Sent' : d.status === 'failed' ? 'Failed' : d.status === 'cancelled' ? 'Discarded' : 'Pending'}
                              </span>
                              {d.status !== 'cancelled' && (
                                <button
                                  onClick={() => handleResendDelivery(d.id)}
                                  disabled={modalBusy === `resend:${d.id}`}
                                  className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
                                  title="Force resend"
                                >
                                  <RotateCw className={`h-3.5 w-3.5 ${modalBusy === `resend:${d.id}` ? 'animate-spin' : ''}`} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {d.status === 'failed' && d.error_message && (
                          <p className="text-xs text-red-500 dark:text-red-400 mt-1 truncate" title={d.error_message}>
                            {d.error_message}
                          </p>
                        )}
                        {d.status === 'awaiting_confirmation' && (
                          <div className="flex items-center justify-end gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!!modalBusy}
                              onClick={() => handleDiscardDelivery(d.id)}
                              className="text-red-500 hover:text-red-600"
                            >
                              {modalBusy === `discard:${d.id}` ? 'Discarding…' : 'Discard'}
                            </Button>
                            <Button
                              size="sm"
                              disabled={!!modalBusy || hasValidationErrors}
                              onClick={() => handleConfirmDelivery(d)}
                            >
                              {modalBusy === `confirm:${d.id}` ? 'Sending…' : 'Confirm & Send'}
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Contact info — pinned first among the forms, since it's
                    the identity fields agents check most. Backed by the real
                    contact-card submission when one exists; otherwise a
                    lightweight fallback bound straight to the conversation
                    (e.g. a name typed in from chat, or an offline-gate
                    capture — neither creates a form submission). */}
                {contactSubmission ? (
                  renderFormCard(contactSubmission)
                ) : (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Contact info</div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Name</label>
                      <Input
                        value={contactFallbackEdits.name ?? conversation.visitor_name ?? ''}
                        placeholder="Visitor name"
                        onChange={(e) => setContactFallbackEdits((prev) => ({ ...prev, name: e.target.value }))}
                        className="text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Email</label>
                      {(() => {
                        const email = contactFallbackEdits.email ?? conversation.visitor_email ?? ''
                        const invalid = !isValidEmailValue(email)
                        return (
                          <>
                            <Input
                              value={email}
                              placeholder="visitor@example.com"
                              onChange={(e) => setContactFallbackEdits((prev) => ({ ...prev, email: e.target.value }))}
                              className={cn('text-sm', invalid && 'border-red-500 focus-visible:ring-red-500')}
                            />
                            {invalid && <p className="text-xs text-red-500 mt-1">Please enter a valid email address.</p>}
                          </>
                        )
                      })()}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Phone</label>
                      <PhoneNumberField
                        value={contactFallbackEdits.phone ?? conversation.visitor_phone ?? ''}
                        onChange={(v) => setContactFallbackEdits((prev) => ({ ...prev, phone: v }))}
                      />
                    </div>
                  </div>
                )}

                {/* Every other submitted form. */}
                {otherSubmissions.map((sub) => renderFormCard(sub))}
              </div>

              {modalError && (
                <div className="px-5 py-2 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
                  <p className="text-xs text-red-500 dark:text-red-400">{modalError}</p>
                </div>
              )}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
                <Button variant="outline" disabled={!!modalBusy} onClick={closeFormsModal}>
                  Close
                </Button>
                <Button disabled={!!modalBusy || !isFormsModalDirty || hasValidationErrors} onClick={handleSaveAll}>
                  {modalBusy === 'save' ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

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

    </div>
  )
}
