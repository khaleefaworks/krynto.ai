import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '@/services/api'
import { API_BASE } from '@/config/endpoints'
import { RefreshCw, Download, HardDriveDownload, Archive } from 'lucide-react'

interface BackupRow {
  id: number
  filename: string
  size_bytes: number | null
  alembic_revision: string | null
  git_commit: string | null
  status: string
  triggered_by: string
  error_message: string | null
  created_at: string | null
  compatibility: 'match' | 'older' | 'unknown'
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

const COMPAT_LABEL: Record<BackupRow['compatibility'], { text: string; className: string }> = {
  match: { text: 'Current version', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  older: { text: 'Older — auto-migrates', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  unknown: { text: 'Unrecognized version', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
}

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  completed: { text: 'Completed', className: 'text-gray-500 dark:text-gray-400' },
  in_progress: { text: 'In progress…', className: 'text-blue-600 dark:text-blue-400' },
  failed: { text: 'Failed', className: 'text-red-600 dark:text-red-400' },
}

export default function SuperAdminBackups() {
  const [backups, setBackups] = useState<BackupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [understandRisk, setUnderstandRisk] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = async () => {
    try {
      setError(null)
      const data = await apiRequest<BackupRow[]>('/admin/backups')
      setBackups(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load backups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  // While anything is in_progress, poll the list so it flips to
  // completed/failed without a manual refresh.
  useEffect(() => {
    const hasPending = backups.some(b => b.status === 'in_progress')
    if (hasPending && !pollRef.current) {
      pollRef.current = setInterval(load, 3000)
    } else if (!hasPending && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [backups])

  const triggerBackup = async () => {
    setCreating(true)
    try {
      await apiRequest('/admin/backups', { method: 'POST' })
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to start backup')
    } finally {
      setCreating(false)
    }
  }

  const downloadBackup = async (b: BackupRow) => {
    const token = localStorage.getItem('auth_token')
    const res = await fetch(`${API_BASE}/admin/backups/${b.id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      alert('Download failed: ' + res.statusText)
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = b.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const openRestoreConfirm = (b: BackupRow) => {
    setRestoreTarget(b)
    setConfirmText('')
    setUnderstandRisk(false)
    setRestoreError(null)
  }

  const confirmRestore = async () => {
    if (!restoreTarget) return
    setRestoring(true)
    setRestoreError(null)
    try {
      await apiRequest(`/admin/backups/${restoreTarget.id}/restore`, {
        method: 'POST',
        body: JSON.stringify({ force: restoreTarget.compatibility === 'unknown' }),
      })
      const poll = setInterval(async () => {
        try {
          const status = await apiRequest<{ status: string; error: string | null }>(
            `/admin/backups/${restoreTarget.id}/restore-status`
          )
          if (status.status === 'completed') {
            clearInterval(poll)
            setRestoring(false)
            setRestoreTarget(null)
            await load()
          } else if (status.status === 'failed') {
            clearInterval(poll)
            setRestoring(false)
            setRestoreError(status.error || 'Restore failed')
          }
        } catch {
          // transient poll failure — keep trying
        }
      }, 3000)
    } catch (e: any) {
      setRestoring(false)
      setRestoreError(e?.message || 'Failed to start restore')
    }
  }

  const confirmPhrase = 'RESTORE'
  const canConfirm =
    confirmText === confirmPhrase &&
    (restoreTarget?.compatibility !== 'unknown' || understandRisk)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Archive size={20} /> Backups
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Automatic backup every 2 hours, plus on-demand. Kept locally, last 12 retained.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={triggerBackup}
            disabled={creating}
            className="flex items-center gap-1.5 text-sm border border-slate-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <HardDriveDownload size={14} />
            {creating ? 'Starting…' : 'Back up now'}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {loading && backups.length === 0 ? (
        <div className="text-center py-16 text-slate-400">Loading…</div>
      ) : backups.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Archive size={40} className="mx-auto mb-3 opacity-30" />
          <p>No backups yet. The first automatic one runs within 2 hours, or start one now.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th className="px-5 py-3">Created</th>
                <th className="px-5 py-3">Trigger</th>
                <th className="px-5 py-3">Size</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Version</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {backups.map(b => {
                const compat = COMPAT_LABEL[b.compatibility]
                const status = STATUS_LABEL[b.status] || { text: b.status, className: 'text-gray-500' }
                return (
                  <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-5 py-3 text-sm text-gray-900 dark:text-white whitespace-nowrap">{formatWhen(b.created_at)}</td>
                    <td className="px-5 py-3 text-sm text-gray-500 dark:text-gray-400 capitalize">{b.triggered_by.replace(/_/g, ' ')}</td>
                    <td className="px-5 py-3 text-sm text-gray-500 dark:text-gray-400">{formatSize(b.size_bytes)}</td>
                    <td className={`px-5 py-3 text-sm ${status.className}`}>{status.text}</td>
                    <td className="px-5 py-3">
                      {b.status === 'completed' && (
                        <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${compat.className}`}>
                          {compat.text}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {b.status === 'completed' && (
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => downloadBackup(b)}
                            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                          >
                            <Download size={12} /> Download
                          </button>
                          <button
                            onClick={() => openRestoreConfirm(b)}
                            className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                          >
                            Restore
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => !restoring && setRestoreTarget(null)} />
          <div className="relative z-[60] w-full max-w-md mx-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Restore backup</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                From {formatWhen(restoreTarget.created_at)}. This overwrites the current database and
                uploads with the backup's contents. A safety backup of the current state is taken
                automatically first, and other active connections will be briefly disconnected.
              </p>

              <div className={`mt-4 rounded-lg px-3 py-2 text-sm ${COMPAT_LABEL[restoreTarget.compatibility].className}`}>
                {COMPAT_LABEL[restoreTarget.compatibility].text}
                {restoreTarget.compatibility === 'older' && ' — migrations will run automatically after restore.'}
                {restoreTarget.compatibility === 'unknown' && " — this backup's schema wasn't recognized. Proceeding may fail or leave the app in a broken state."}
              </div>

              {restoreTarget.compatibility === 'unknown' && (
                <label className="mt-3 flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={understandRisk}
                    onChange={e => setUnderstandRisk(e.target.checked)}
                    className="mt-0.5"
                  />
                  I understand this backup's version is unrecognized and want to restore anyway.
                </label>
              )}

              <label className="block text-xs text-gray-500 dark:text-gray-400 mt-4 mb-1">
                Type <span className="font-mono font-semibold">{confirmPhrase}</span> to confirm
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                disabled={restoring}
              />

              {restoreError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                  {restoreError}
                </div>
              )}

              <div className="mt-5 flex justify-end gap-3">
                <button
                  onClick={() => setRestoreTarget(null)}
                  disabled={restoring}
                  className="px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-700 text-sm text-gray-700 dark:text-gray-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmRestore}
                  disabled={!canConfirm || restoring}
                  className="px-4 py-2 rounded-md bg-red-600 text-white text-sm hover:bg-red-700 disabled:opacity-50"
                >
                  {restoring ? 'Restoring…' : 'Restore'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
