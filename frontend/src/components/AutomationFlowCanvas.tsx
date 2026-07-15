import { useState, useCallback, useEffect } from 'react'
import {
  ReactFlow, Background, Controls,
  useNodesState, useEdgesState, addEdge,
  Handle, Position, MarkerType,
  type Node, type Edge, type Connection, type NodeProps, type ColorMode,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { X, Plus, Trash2, RotateCcw, ChevronUp, ChevronDown } from 'lucide-react'
import { apiRequest } from '@/services/api'
import {
  automationsApi,
  type Automation,
  type AutomationNode,
  type AutomationEdge,
  type AutomationTrigger,
} from '@/services/automations'

// ─── Node type metadata ────────────────────────────────────────────────────

const NODE_META: Record<string, { label: string; icon: string; color: string }> = {
  trigger:            { label: 'Trigger',        icon: '⚡', color: 'bg-purple-100 dark:bg-purple-950 border-purple-400' },
  send_bot_message:   { label: 'Bot message',    icon: '💬', color: 'bg-blue-50 dark:bg-blue-950 border-blue-400' },
  emit_system_event:  { label: 'System event',   icon: '📢', color: 'bg-gray-100 dark:bg-gray-800 border-gray-400' },
  wait:               { label: 'Wait',            icon: '⏱',  color: 'bg-yellow-50 dark:bg-yellow-950 border-yellow-400' },
  condition:          { label: 'Condition',       icon: '🔀', color: 'bg-orange-50 dark:bg-orange-950 border-orange-400' },
  show_rating_popup:  { label: 'Rating popup',   icon: '⭐', color: 'bg-green-50 dark:bg-green-950 border-green-400' },
  tag_conversation:   { label: 'Tag',             icon: '🏷',  color: 'bg-pink-50 dark:bg-pink-950 border-pink-400' },
  tag_with_agent_name:{ label: 'Tag agent name', icon: '👤', color: 'bg-pink-50 dark:bg-pink-950 border-pink-400' },
  bot_prompt_buttons: { label: 'Button prompt',  icon: '🤖', color: 'bg-indigo-50 dark:bg-indigo-950 border-indigo-400' },
  end:                { label: 'End',             icon: '🔚', color: 'bg-red-50 dark:bg-red-950 border-red-400' },
  repeat_new_chat_notification: { label: 'Repeat notification', icon: '🔁', color: 'bg-teal-50 dark:bg-teal-950 border-teal-400' },
}

const PALETTE_NODES = [
  'send_bot_message', 'emit_system_event', 'wait', 'condition',
  'show_rating_popup', 'tag_conversation', 'tag_with_agent_name',
  'bot_prompt_buttons', 'repeat_new_chat_notification', 'end',
]

const TRIGGERS: { value: AutomationTrigger; label: string }[] = [
  { value: 'visitor_connected',          label: 'Visitor connected' },
  { value: 'visitor_new',                label: 'New visitor' },
  { value: 'visitor_returning',          label: 'Returning visitor' },
  { value: 'visitor_socket_connected',   label: 'Visitor socket connected' },
  { value: 'visitor_dropped',            label: 'Visitor dropped' },
  { value: 'visitor_reconnected',        label: 'Visitor reconnected' },
  { value: 'no_agent_assigned_for',      label: 'No agent assigned for…' },
  { value: 'new_chat_unclaimed',         label: 'New chat unclaimed (repeat reminder)' },
  { value: 'website_offline_first_message', label: 'Website offline (first message)' },
  { value: 'agent_joined',              label: 'Agent joined' },
  { value: 'conversation_created',       label: 'Conversation created' },
  { value: 'conversation_visitor_ended', label: 'Visitor ended chat' },
  { value: 'conversation_resolved',      label: 'Conversation resolved' },
  { value: 'bot_conversation_resolved',  label: 'Bot resolved chat (bot-only)' },
  { value: 'conversation_auto_resolved', label: 'Auto-resolved' },
  { value: 'conversation_reopened',      label: 'Conversation reopened' },
]

// Triggers the backend always fires with send_to_visitor=False, hardcoded at
// the ConversationOrchestrator call site — no node in these flows can ever
// reach the visitor, regardless of this node's own "Send to visitor" toggle.
// Keep in sync with the `trigger=` call sites in conversation_orchestrator.py.
const AGENT_ONLY_TRIGGERS = new Set<string>([
  'agent_joined',
  'visitor_dropped',
  'visitor_reconnected',
  'visitor_socket_connected',
  'visitor_rated_conversation',
])

// ─── Summary helpers ──────────────────────────────────────────────────────

function nodeSummary(type: string, config: Record<string, any>): string {
  if (type === 'send_bot_message') return config.message ? `"${config.message.slice(0, 40)}…"` : ''
  if (type === 'emit_system_event') return config.content ? `"${config.content.slice(0, 40)}…"` : ''
  if (type === 'wait') return config.seconds ? `${config.seconds}s` : ''
  if (type === 'condition') return config.field || ''
  if (type === 'tag_conversation') return config.tag || ''
  if (type === 'bot_prompt_buttons') return config.message ? `"${config.message.slice(0, 30)}…"` : ''
  if (type === 'repeat_new_chat_notification') return config.interval_seconds ? `every ${config.interval_seconds}s` : ''
  if (type === 'trigger') {
    const parts = []
    if (config.repeat === 'cooldown') parts.push(`cooldown ${config.cooldown_hours ?? 24}h`)
    if (config.repeat === 'once') parts.push('once')
    if (config.repeat === 'always') parts.push('always')
    if (config.delay_seconds) parts.push(`delay ${config.delay_seconds}s`)
    return parts.join(', ')
  }
  return ''
}

// ─── Custom node component ────────────────────────────────────────────────

function FlowNode({ id, data, selected }: NodeProps) {
  const meta = NODE_META[data.type as string] || { label: data.type, icon: '?', color: 'bg-white border-gray-300' }
  const isTrigger = data.type === 'trigger'
  const isCondition = data.type === 'condition'
  const isEnd = data.type === 'end'
  const summary = nodeSummary(data.type as string, (data.config as Record<string, any>) || {})

  return (
    <div
      className={`rounded-xl border-2 ${meta.color} ${selected ? 'ring-2 ring-blue-500 ring-offset-1' : ''} p-3 min-w-[180px] max-w-[220px] shadow-sm cursor-pointer select-none`}
    >
      {!isTrigger && <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400" />}
      <div className="flex items-center gap-2">
        <span className="text-base">{meta.icon}</span>
        <span className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{meta.label}</span>
      </div>
      {summary && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 truncate">{summary}</div>
      )}
      {isCondition ? (
        <>
          <Handle type="source" position={Position.Bottom} id="true"  style={{ left: '30%' }}  className="!w-3 !h-3 !bg-green-500" />
          <Handle type="source" position={Position.Bottom} id="false" style={{ left: '70%' }}  className="!w-3 !h-3 !bg-red-500" />
          <div className="flex justify-between mt-1 text-[10px] text-gray-400 px-1">
            <span>true</span><span>false</span>
          </div>
        </>
      ) : !isEnd ? (
        <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-gray-400" />
      ) : null}
    </div>
  )
}

const NODE_TYPES = { automationNode: FlowNode }

// ─── Serialization helpers ────────────────────────────────────────────────

function toRFNodes(nodes: AutomationNode[]): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    type: 'automationNode',
    position: n.position,
    data: { type: n.type, config: n.config, label: n.type },
  }))
}

function toRFEdges(edges: AutomationEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    sourceHandle: e.branch ?? undefined,
    label: e.branch ?? undefined,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: { stroke: '#6b7280' },
  }))
}

function fromRFNodes(rfNodes: Node[]): AutomationNode[] {
  return rfNodes.map((n) => ({
    id: n.id,
    type: (n.data.type as string) as AutomationNode['type'],
    config: (n.data.config as Record<string, any>) || {},
    position: n.position,
  }))
}

function fromRFEdges(rfEdges: Edge[]): AutomationEdge[] {
  return rfEdges.map((e) => ({
    id: e.id,
    from: e.source,
    to: e.target,
    branch: (e.sourceHandle as 'true' | 'false') ?? null,
  }))
}

function newNodeId() {
  return `n${Date.now().toString(36)}`
}

function defaultConfig(type: string): Record<string, any> {
  if (type === 'trigger') return { repeat: 'once' }
  if (type === 'send_bot_message') return { message: '', event_type: '' }
  if (type === 'emit_system_event') return { content: '', event_type: '', visitor_content: '', send_to_visitor: true, show_notification: false }
  if (type === 'wait') return { seconds: 5 }
  if (type === 'condition') return { field: 'agent_online' }
  if (type === 'show_rating_popup') return { event_type: 'rating_popup_shown' }
  if (type === 'tag_conversation') return { tag: '' }
  if (type === 'tag_with_agent_name') return {}
  if (type === 'bot_prompt_buttons') return { message: '', allow_input: false, suppress_waiting_message: false, buttons: [] }
  if (type === 'repeat_new_chat_notification') return { interval_seconds: 15 }
  return {}
}

// ─── Recursive button editor ─────────────────────────────────────────────────

const MAX_BTN_DEPTH = 4
const DEPTH_BORDER: Record<number, string> = {
  0: 'border-indigo-400',
  1: 'border-purple-400',
  2: 'border-blue-400',
  3: 'border-teal-400',
}

interface ButtonEditorProps {
  buttons: any[]
  onChange: (buttons: any[]) => void
  websiteTeams: { id: number; name: string }[]
  depth: number
}

function ButtonEditor({ buttons, onChange, websiteTeams, depth }: ButtonEditorProps) {
  const canNest = depth < MAX_BTN_DEPTH
  const borderCls = DEPTH_BORDER[Math.min(depth, 3)]

  function updateBtn(i: number, patch: Record<string, any>) {
    const next = [...buttons]
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }

  function updateSubPrompt(i: number, patch: Record<string, any>) {
    const next = [...buttons]
    next[i] = { ...next[i], sub_prompt: { ...next[i].sub_prompt, ...patch } }
    onChange(next)
  }

  // Buttons render to the widget in this same array order, so reordering
  // here is the whole fix — no separate "widget order" to keep in sync.
  function moveBtn(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= buttons.length) return
    const next = [...buttons]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <>
      {buttons.map((btn: any, i: number) => (
        <div
          key={i}
          className={`border rounded p-2 mb-2 space-y-1.5 ${
            depth === 0
              ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
          }`}
        >
          {/* Label + reorder + delete */}
          <div className="flex items-center gap-1">
            <div className="flex flex-col flex-shrink-0 -my-1">
              <button
                onClick={() => moveBtn(i, -1)}
                disabled={i === 0}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-25 disabled:hover:text-gray-400"
                title="Move up"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => moveBtn(i, 1)}
                disabled={i === buttons.length - 1}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-25 disabled:hover:text-gray-400"
                title="Move down"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            <Input
              value={btn.label || ''}
              onChange={(e) => updateBtn(i, { label: e.target.value })}
              placeholder="Button label"
              className="h-7 text-xs flex-1"
            />
            <button
              onClick={() => onChange(buttons.filter((_: any, j: number) => j !== i))}
              className="text-red-400 hover:text-red-600 flex-shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* Sub-prompt toggle — only available below max depth */}
          {canNest && (
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">
                Sub-prompt (multi-step)
              </span>
              <Switch
                checked={!!btn.sub_prompt}
                onCheckedChange={(v) =>
                  updateBtn(i, {
                    sub_prompt: v
                      ? { message: '', allow_input: false, suppress_waiting_message: false, collect_contact: true, buttons: [] }
                      : null,
                  })
                }
              />
            </div>
          )}

          {/* Team assignment — applies to both leaf and branch buttons.
              For branch buttons the team is assigned immediately on click so agents
              see the routing before the visitor picks a sub-option. */}
          {websiteTeams.length > 0 && (
            <select
              value={btn.team_id ?? ''}
              onChange={(e) =>
                updateBtn(i, { team_id: e.target.value === '' ? null : Number(e.target.value) })
              }
              className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-xs"
            >
              <option value="">— No team assigned —</option>
              {websiteTeams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}

          {/* ── Leaf button config ── */}
          {!btn.sub_prompt && (
            <>
              <Input
                value={btn.reply || ''}
                onChange={(e) => updateBtn(i, { reply: e.target.value })}
                placeholder="Bot reply after click (optional)"
                className="h-7 text-xs"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">
                  Bot-only (auto-resolve, no agent)
                </span>
                <Switch
                  checked={!!btn.bot_only}
                  onCheckedChange={(v) => updateBtn(i, { bot_only: v, collect_contact: v ? false : btn.collect_contact })}
                />
              </div>
              {btn.bot_only && (
                <>
                  <Input
                    value={btn.bot_only_message || ''}
                    onChange={(e) => updateBtn(i, { bot_only_message: e.target.value })}
                    placeholder='Agent-only timeline note (default: "Bot joined the chat.")'
                    className="h-7 text-xs"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 flex-1">
                      Auto-resolve delay (seconds)
                    </span>
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      value={btn.resolve_delay_seconds ?? 3}
                      onChange={(e) => updateBtn(i, { resolve_delay_seconds: Math.max(1, Math.min(30, Number(e.target.value) || 3)) })}
                      className="h-7 text-xs w-16 text-center"
                    />
                  </div>
                </>
              )}
              {!btn.bot_only && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    Collect contact if offline
                  </span>
                  <Switch
                    checked={btn.collect_contact !== false}
                    onCheckedChange={(v) => updateBtn(i, { collect_contact: v })}
                  />
                </div>
              )}
            </>
          )}

          {/* ── Branch (sub-prompt) config ── */}
          {btn.sub_prompt && (
            <div className={`ml-1 pl-2 border-l-2 ${borderCls} space-y-1.5 pt-1`}>
              <Textarea
                value={btn.sub_prompt.message || ''}
                onChange={(e) => updateSubPrompt(i, { message: e.target.value })}
                placeholder="Sub-prompt message…"
                rows={2}
                className="text-xs"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">
                  Bot-only branch (no agent, auto-resolve)
                </span>
                <Switch
                  checked={!!btn.sub_prompt.bot_only}
                  onCheckedChange={(v) => updateSubPrompt(i, {
                    bot_only: v,
                    collect_contact: v ? false : btn.sub_prompt.collect_contact,
                    suppress_waiting_message: v ? true : btn.sub_prompt.suppress_waiting_message,
                  })}
                />
              </div>
              {btn.sub_prompt.bot_only && (
                <Input
                  value={btn.sub_prompt.bot_only_message || ''}
                  onChange={(e) => updateSubPrompt(i, { bot_only_message: e.target.value })}
                  placeholder='Agent-only timeline note (default: "Bot joined the chat.")'
                  className="h-7 text-xs"
                />
              )}
              {!btn.sub_prompt.bot_only && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                      Allow free-text input
                    </span>
                    <Switch
                      checked={!!btn.sub_prompt.allow_input}
                      onCheckedChange={(v) => updateSubPrompt(i, { allow_input: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                      Suppress waiting message
                    </span>
                    <Switch
                      checked={!!btn.sub_prompt.suppress_waiting_message}
                      onCheckedChange={(v) => updateSubPrompt(i, { suppress_waiting_message: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                      Collect contact if offline
                    </span>
                    <Switch
                      checked={btn.sub_prompt.collect_contact !== false}
                      onCheckedChange={(v) => updateSubPrompt(i, { collect_contact: v })}
                    />
                  </div>
                </>
              )}
              {/* Recursive sub-buttons */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  Sub-buttons {depth < MAX_BTN_DEPTH - 1 ? '' : '(max depth)'}
                </span>
                <button
                  onClick={() =>
                    updateSubPrompt(i, {
                      buttons: [
                        ...(btn.sub_prompt.buttons || []),
                        { label: '', reply: '', team_id: null, sub_prompt: null, collect_contact: true },
                      ],
                    })
                  }
                  className="text-indigo-500 hover:text-indigo-700 text-[11px] flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              <ButtonEditor
                buttons={btn.sub_prompt.buttons || []}
                onChange={(subBtns) => updateSubPrompt(i, { buttons: subBtns })}
                websiteTeams={websiteTeams}
                depth={depth + 1}
              />
            </div>
          )}
        </div>
      ))}
    </>
  )
}

// ─── Node config panel ────────────────────────────────────────────────────

function NodeConfigPanel({
  node,
  onChange,
  onDelete,
  websiteTeams = [],
  trigger,
}: {
  node: Node
  onChange: (config: Record<string, any>) => void
  onDelete: () => void
  websiteTeams?: { id: number; name: string }[]
  trigger?: string
}) {
  const type = node.data.type as string
  const cfg = (node.data.config as Record<string, any>) || {}
  const set = (patch: Record<string, any>) => onChange({ ...cfg, ...patch })
  const forcedAgentOnly = Boolean(trigger && AGENT_ONLY_TRIGGERS.has(trigger))

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-gray-900 dark:text-gray-100">
          {NODE_META[type]?.icon} {NODE_META[type]?.label}
        </span>
        {type !== 'trigger' && (
          <button onClick={onDelete} className="text-red-500 hover:text-red-700">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {type === 'trigger' && (
        <>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Repeat</label>
            <select
              value={cfg.repeat || 'once'}
              onChange={(e) => set({ repeat: e.target.value })}
              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-xs"
            >
              <option value="once">Once per conversation</option>
              <option value="cooldown">Cooldown</option>
              <option value="always">Always</option>
            </select>
          </div>
          {cfg.repeat === 'cooldown' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Cooldown (seconds)</label>
              <Input
                type="number" min={1}
                value={cfg.cooldown_seconds ?? (cfg.cooldown_hours != null ? cfg.cooldown_hours * 3600 : 10)}
                onChange={(e) => set({ cooldown_seconds: Number(e.target.value), cooldown_hours: undefined })}
                className="h-8 text-xs"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Delay (seconds, optional)</label>
            <Input
              type="number" min={0}
              value={cfg.delay_seconds ?? ''}
              placeholder="0"
              onChange={(e) => set({ delay_seconds: e.target.value ? Number(e.target.value) : undefined })}
              className="h-8 text-xs"
            />
          </div>
        </>
      )}

      {type === 'send_bot_message' && (
        <>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Message</label>
            <Textarea
              value={cfg.message || ''}
              onChange={(e) => set({ message: e.target.value })}
              placeholder="Bot message text…"
              rows={3}
              className="text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Event type (optional)</label>
            <Input
              value={cfg.event_type || ''}
              onChange={(e) => set({ event_type: e.target.value })}
              placeholder="e.g. bot_waiting"
              className="h-8 text-xs"
            />
          </div>
        </>
      )}

      {type === 'emit_system_event' && (
        <>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Agent-side content</label>
            <Textarea
              value={cfg.content || ''}
              onChange={(e) => set({ content: e.target.value })}
              placeholder="e.g. {agent_name} resolved the chat."
              rows={2}
              className="text-xs"
            />
          </div>
          {!forcedAgentOnly && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Visitor-side content (optional)</label>
              <Input
                value={cfg.visitor_content || ''}
                onChange={(e) => set({ visitor_content: e.target.value })}
                placeholder="e.g. Chat resolved."
                className="h-8 text-xs"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Event type</label>
            <Input
              value={cfg.event_type || ''}
              onChange={(e) => set({ event_type: e.target.value })}
              placeholder="e.g. conversation_resolved"
              className="h-8 text-xs"
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <div>
              <span className={`text-xs font-medium ${forcedAgentOnly ? 'text-gray-400 dark:text-gray-600' : 'text-gray-700 dark:text-gray-300'}`}>Send to visitor</span>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                {forcedAgentOnly
                  ? 'This trigger is always agent-only — the visitor never sees it, regardless of this setting.'
                  : 'Disable for agent-only messages'}
              </p>
            </div>
            <Switch
              checked={!forcedAgentOnly && cfg.send_to_visitor !== false}
              disabled={forcedAgentOnly}
              onCheckedChange={(v) => set({ send_to_visitor: v })}
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <div>
              <span className="text-xs text-gray-700 dark:text-gray-300 font-medium">Notify agents</span>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Play sound + push, same as a new message</p>
            </div>
            <Switch
              checked={cfg.show_notification === true}
              onCheckedChange={(v) => set({ show_notification: v })}
            />
          </div>
        </>
      )}

      {type === 'wait' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Wait (seconds)</label>
          <Input
            type="number" min={1}
            value={cfg.seconds || 5}
            onChange={(e) => set({ seconds: Number(e.target.value) })}
            className="h-8 text-xs"
          />
        </div>
      )}

      {type === 'repeat_new_chat_notification' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Repeat every (seconds)</label>
          <Input
            type="number" min={1}
            value={cfg.interval_seconds || 15}
            onChange={(e) => set({ interval_seconds: Number(e.target.value) })}
            className="h-8 text-xs"
          />
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
            While a new chat sits unclaimed, re-fires the sound + push notification at this
            interval until an agent joins. Disable this automation to go back to a single
            one-shot notification.
          </p>
        </div>
      )}

      {type === 'condition' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Condition field</label>
          <select
            value={cfg.field || 'agent_online'}
            onChange={(e) => set({ field: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-xs"
          >
            <option value="agent_online">Agent online?</option>
            <option value="is_first_visit">First visit?</option>
            <option value="has_tag">Has tag?</option>
          </select>
          {cfg.field === 'has_tag' && (
            <Input
              value={cfg.value || ''}
              onChange={(e) => set({ value: e.target.value })}
              placeholder="Tag name"
              className="h-8 text-xs mt-2"
            />
          )}
        </div>
      )}

      {type === 'show_rating_popup' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Event type</label>
          <Input
            value={cfg.event_type || 'rating_popup_shown'}
            onChange={(e) => set({ event_type: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
      )}

      {type === 'tag_conversation' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tag name</label>
          <Input
            value={cfg.tag || ''}
            onChange={(e) => set({ tag: e.target.value })}
            placeholder="e.g. follow-up"
            className="h-8 text-xs"
          />
        </div>
      )}

      {type === 'bot_prompt_buttons' && (
        <>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Message</label>
            <Textarea
              value={cfg.message || ''}
              onChange={(e) => set({ message: e.target.value })}
              placeholder="Button prompt message…"
              rows={2}
              className="text-xs"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600 dark:text-gray-400">Allow free-text input</span>
            <Switch
              checked={!!cfg.allow_input}
              onCheckedChange={(v) => set({ allow_input: v })}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Buttons</label>
              <button
                onClick={() => set({ buttons: [...(cfg.buttons || []), { label: '', reply: '', team_id: null, sub_prompt: null, collect_contact: true }] })}
                className="text-blue-500 hover:text-blue-700 text-xs flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            <ButtonEditor
              buttons={cfg.buttons || []}
              onChange={(buttons) => set({ buttons })}
              websiteTeams={websiteTeams}
              depth={0}
            />
          </div>
        </>
      )}

      {(type === 'tag_with_agent_name' || type === 'end') && (
        <p className="text-xs text-gray-500 dark:text-gray-400">No configuration needed.</p>
      )}
    </div>
  )
}

// ─── Main canvas component ────────────────────────────────────────────────

interface Props {
  websiteId: number
  automation: Automation | null
  onClose: () => void
  onSaved: () => void
}

function makeTriggerNode(_trigger: string): Node {
  return {
    id: 'trigger',
    type: 'automationNode',
    position: { x: 200, y: 40 },
    data: { type: 'trigger', config: { repeat: 'once' }, label: 'trigger' },
    deletable: false,
  }
}

export default function AutomationFlowCanvas({ websiteId, automation, onClose, onSaved }: Props) {
  const [name, setName] = useState(automation?.name || 'New automation')
  const [trigger, setTrigger] = useState<string>(automation?.trigger || 'visitor_connected')
  const [category, setCategory] = useState<string>(automation?.category || 'auto_message')
  const [enabled, setEnabled] = useState(automation?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [websiteTeams, setWebsiteTeams] = useState<{ id: number; name: string }[]>([])
  const [colorMode, setColorMode] = useState<ColorMode>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  )

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setColorMode(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    apiRequest<any[]>('/teams/overview').then((data) => {
      if (!cancelled && Array.isArray(data)) {
        // WebsiteTeamsOverview uses `.id` for the website id, not `.website_id`
        const teams = data
          .filter((w: any) => !websiteId || Number(w.id) === Number(websiteId))
          .flatMap((w: any) => w.teams || [])
          .map((t: any) => ({ id: Number(t.id), name: String(t.name) }))
        setWebsiteTeams(teams)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [websiteId])

  const initialNodes: Node[] = automation?.nodes?.length
    ? toRFNodes(automation.nodes)
    : [makeTriggerNode(trigger)]

  const initialEdges: Edge[] = automation?.edges?.length
    ? toRFEdges(automation.edges)
    : []

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge({
          ...connection,
          id: `e${Date.now()}`,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          style: { stroke: '#6b7280' },
          label: connection.sourceHandle ?? undefined,
        }, eds)
      )
    },
    [setEdges]
  )

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null

  const addNode = (type: string) => {
    const lastNode = nodes[nodes.length - 1]
    const y = lastNode ? lastNode.position.y + 150 : 200
    const id = newNodeId()
    const newNode: Node = {
      id,
      type: 'automationNode',
      position: { x: 200, y },
      data: { type, config: defaultConfig(type), label: type },
    }
    setNodes((nds) => [...nds, newNode])
    setSelectedNodeId(id)
  }

  const updateSelectedNodeConfig = (config: Record<string, any>) => {
    if (!selectedNodeId) return
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNodeId ? { ...n, data: { ...n.data, config } } : n
      )
    )
  }

  const deleteSelectedNode = () => {
    if (!selectedNodeId || selectedNodeId === 'trigger') return
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId))
    setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId))
    setSelectedNodeId(null)
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      const outNodes = fromRFNodes(nodes)
      // keep trigger column in sync with trigger node
      const triggerNode = outNodes.find((n) => n.type === 'trigger')
      if (triggerNode) triggerNode.config = triggerNode.config || {}

      const payload = {
        name: name.trim(),
        trigger,
        category,
        enabled,
        nodes: outNodes,
        edges: fromRFEdges(edges),
      }
      if (automation?.id) {
        await automationsApi.update(automation.id, payload)
      } else {
        await automationsApi.create({ website_id: websiteId, ...payload })
      }
      onSaved()
    } catch (e: any) {
      setError(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleResetToDefault = async () => {
    if (!resetConfirm) {
      setResetConfirm(true)
      return
    }
    setResetting(true)
    setError(null)
    try {
      const updated = await automationsApi.resetToDefault(automation!.id)
      setNodes(updated.nodes?.length ? toRFNodes(updated.nodes) : [makeTriggerNode(trigger)])
      setEdges(updated.edges?.length ? toRFEdges(updated.edges) : [])
      setName(updated.name)
      setTrigger(updated.trigger)
      setEnabled(updated.enabled)
      setResetConfirm(false)
    } catch (e: any) {
      setError(e?.message || 'Failed to reset')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shrink-0 h-16">
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
          <X className="w-5 h-5" />
        </button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-xs h-8 text-sm font-medium"
          placeholder="Automation name"
        />
        <select
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
        >
          {TRIGGERS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
        >
          <option value="auto_message">Message flow</option>
          <option value="chatbot_flow">Chatbot flow</option>
        </select>
        <div className="flex items-center gap-2 ml-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <span className="text-sm text-gray-500">{enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {error && <span className="text-sm text-red-500">{error}</span>}
          {automation?.id && automation?.template_id ? (
            resetConfirm ? (
              <>
                <span className="text-sm text-amber-600 dark:text-amber-400">Reset to template defaults?</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResetConfirm(false)}
                  disabled={resetting}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetToDefault}
                  disabled={resetting}
                  className="text-amber-600 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:hover:bg-amber-900/20"
                >
                  {resetting ? 'Resetting…' : 'Confirm reset'}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetToDefault}
                title="Reset nodes and edges back to the library template defaults"
                className="text-amber-600 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:hover:bg-amber-900/20"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                Reset to default
              </Button>
            )
          ) : null}
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save flow'}
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Node palette */}
        <div className="w-48 shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 overflow-y-auto">
          <div className="p-3 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Add node
          </div>
          {PALETTE_NODES.map((type) => {
            const meta = NODE_META[type]
            return (
              <button
                key={type}
                onClick={() => addNode(type)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 text-left"
              >
                <span>{meta.icon}</span>
                <span>{meta.label}</span>
                <Plus className="w-3 h-3 ml-auto text-gray-400" />
              </button>
            )
          })}
        </div>

        {/* Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={NODE_TYPES}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            colorMode={colorMode}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1.3 }}
            deleteKeyCode={null}
          >
            <Background gap={16} size={1} className="!bg-gray-50 dark:!bg-gray-950" />
            <Controls position='bottom-left' />
          </ReactFlow>
        </div>

        {/* Config panel */}
        <div className="w-96 shrink-0 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 overflow-y-auto">
          {selectedNode ? (
            <NodeConfigPanel
              node={selectedNode}
              onChange={updateSelectedNodeConfig}
              onDelete={deleteSelectedNode}
              websiteTeams={websiteTeams}
              trigger={trigger}
            />
          ) : (
            <div className="p-4 text-sm text-gray-400 dark:text-gray-500">
              Click a node to configure it, or add nodes from the palette on the left.
              <br /><br />
              Connect nodes by dragging from the bottom handle of one node to the top handle of another.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
