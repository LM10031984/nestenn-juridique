'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Clock, GitMerge, RefreshCw, AlertTriangle } from 'lucide-react'

interface PendingDomain {
  id: string
  suggested_name: string
  suggested_label: string
  confidence_avg: number
  article_count: number
  sample_keywords: string[]
  status: string
  created_at: string
  merged_into: string | null
}

interface ActiveDomain {
  domain: string
  count: number
}

interface Stats {
  pending: number
  approved: number
  rejected: number
  merged: number
  auto_created: number
  auto_created_this_month: number
}

const statusConfig: Record<string, { label: string; className: string }> = {
  pending:      { label: 'En attente',   className: 'text-yellow-400 bg-yellow-400/10' },
  approved:     { label: 'Approuvé',     className: 'text-green-400 bg-green-400/10' },
  rejected:     { label: 'Rejeté',       className: 'text-red-400 bg-red-400/10' },
  merged:       { label: 'Fusionné',     className: 'text-blue-400 bg-blue-400/10' },
  auto_created: { label: 'Auto-créé',    className: 'text-purple-400 bg-purple-400/10' },
}

export default function AdminDomainsPage() {
  const [pending, setPending] = useState<PendingDomain[]>([])
  const [activeDomains, setActiveDomains] = useState<ActiveDomain[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Rename / merge state
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValues, setRenameValues] = useState({ name: '', label: '' })
  const [mergingId, setMergingId] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/pending-domains')
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setPending(data.pending ?? [])
      setActiveDomains(data.activeDomains ?? [])
      setStats(data.stats ?? null)
    } catch (e) {
      setError('Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  async function handleAction(id: string, action: string, extra?: Record<string, string>) {
    setActionLoading(id + action)
    try {
      const res = await fetch(`/api/admin/pending-domains/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...extra }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      await fetchData()
    } catch {
      setError('Erreur lors de l\'action')
    } finally {
      setActionLoading(null)
      setRenamingId(null)
      setMergingId(null)
    }
  }

  const pendingList = pending.filter(d => d.status === 'pending')
  const autoCreatedThisMonth = stats?.auto_created_this_month ?? 0

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Gestion des domaines</h1>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:text-white border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Actualiser
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 text-red-400 bg-red-400/10 rounded-lg border border-red-400/20">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Statistiques */}
      {stats && (
        <section>
          <h2 className="text-lg font-semibold text-slate-200 mb-3">Statistiques</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'En attente', value: stats.pending, color: 'text-yellow-400' },
              { label: 'Approuvés', value: stats.approved, color: 'text-green-400' },
              { label: 'Rejetés', value: stats.rejected, color: 'text-red-400' },
              { label: 'Fusionnés', value: stats.merged, color: 'text-blue-400' },
              { label: 'Auto-créés', value: stats.auto_created, color: 'text-purple-400' },
            ].map(s => (
              <div key={s.label} className="p-4 bg-slate-800 rounded-xl border border-slate-700 text-center">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-slate-400 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Auto-créations ce mois */}
      <section>
        <h2 className="text-lg font-semibold text-slate-200 mb-3">Auto-créations ce mois-ci</h2>
        <div className="flex items-center gap-3 p-4 bg-slate-800 rounded-xl border border-slate-700">
          <div className="text-3xl font-bold text-purple-400">{autoCreatedThisMonth}</div>
          <div className="text-slate-400">/ 5 maximum par mois</div>
          <div className="ml-auto flex gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={`h-3 w-6 rounded-sm ${i < autoCreatedThisMonth ? 'bg-purple-500' : 'bg-slate-700'}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Domaines en attente de validation */}
      <section>
        <h2 className="text-lg font-semibold text-slate-200 mb-3">
          Domaines en attente de validation
          {pendingList.length > 0 && (
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-yellow-400/10 text-yellow-400">
              {pendingList.length}
            </span>
          )}
        </h2>

        {loading ? (
          <div className="text-slate-400 text-sm">Chargement…</div>
        ) : pendingList.length === 0 ? (
          <div className="p-4 text-slate-500 text-sm bg-slate-800 rounded-xl border border-slate-700">
            Aucun domaine en attente.
          </div>
        ) : (
          <div className="space-y-3">
            {pendingList.map(domain => (
              <div
                key={domain.id}
                className="p-4 bg-slate-800 rounded-xl border border-slate-700 space-y-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono text-slate-300 bg-slate-900 px-2 py-0.5 rounded">
                        {domain.suggested_name}
                      </code>
                      <span className="text-slate-400 text-sm">{domain.suggested_label}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span>{domain.article_count} article{domain.article_count > 1 ? 's' : ''}</span>
                      <span>Confiance moy. {(domain.confidence_avg * 100).toFixed(0)}%</span>
                      <span>{new Date(domain.created_at).toLocaleDateString('fr-FR')}</span>
                    </div>
                    {domain.sample_keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {domain.sample_keywords.map(kw => (
                          <span key={kw} className="px-2 py-0.5 text-xs bg-slate-700 text-slate-300 rounded-full">
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleAction(domain.id, 'approve')}
                      disabled={!!actionLoading}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg hover:bg-green-500/20 transition-colors disabled:opacity-50"
                    >
                      <CheckCircle className="h-3 w-3" />
                      Approuver
                    </button>
                    <button
                      onClick={() => { setRenamingId(domain.id); setRenameValues({ name: domain.suggested_name, label: domain.suggested_label }) }}
                      disabled={!!actionLoading}
                      className="px-3 py-1.5 text-xs bg-slate-700 text-slate-300 border border-slate-600 rounded-lg hover:bg-slate-600 transition-colors disabled:opacity-50"
                    >
                      Renommer
                    </button>
                    <button
                      onClick={() => { setMergingId(domain.id); setMergeTarget('') }}
                      disabled={!!actionLoading}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                    >
                      <GitMerge className="h-3 w-3" />
                      Fusionner
                    </button>
                    <button
                      onClick={() => handleAction(domain.id, 'reject')}
                      disabled={!!actionLoading}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50"
                    >
                      <XCircle className="h-3 w-3" />
                      Rejeter
                    </button>
                  </div>
                </div>

                {/* Inline rename form */}
                {renamingId === domain.id && (
                  <div className="flex items-end gap-2 pt-2 border-t border-slate-700">
                    <div className="flex-1">
                      <label className="block text-xs text-slate-400 mb-1">Nom technique (snake_case)</label>
                      <input
                        type="text"
                        value={renameValues.name}
                        onChange={e => setRenameValues(v => ({ ...v, name: e.target.value }))}
                        className="w-full px-3 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:border-slate-400"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-slate-400 mb-1">Label français</label>
                      <input
                        type="text"
                        value={renameValues.label}
                        onChange={e => setRenameValues(v => ({ ...v, label: e.target.value }))}
                        className="w-full px-3 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:border-slate-400"
                      />
                    </div>
                    <button
                      onClick={() => handleAction(domain.id, 'rename', { name: renameValues.name, label: renameValues.label })}
                      className="px-3 py-1.5 text-xs bg-slate-600 text-white rounded-lg hover:bg-slate-500 transition-colors"
                    >
                      Valider
                    </button>
                    <button
                      onClick={() => setRenamingId(null)}
                      className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                    >
                      Annuler
                    </button>
                  </div>
                )}

                {/* Inline merge form */}
                {mergingId === domain.id && (
                  <div className="flex items-end gap-2 pt-2 border-t border-slate-700">
                    <div className="flex-1">
                      <label className="block text-xs text-slate-400 mb-1">Fusionner dans le domaine existant (snake_case)</label>
                      <input
                        type="text"
                        value={mergeTarget}
                        onChange={e => setMergeTarget(e.target.value)}
                        placeholder="ex: copropriete"
                        className="w-full px-3 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:border-slate-400"
                      />
                    </div>
                    <button
                      onClick={() => handleAction(domain.id, 'merge', { target: mergeTarget })}
                      disabled={!mergeTarget.trim()}
                      className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50"
                    >
                      Fusionner
                    </button>
                    <button
                      onClick={() => setMergingId(null)}
                      className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                    >
                      Annuler
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Domaines actifs */}
      <section>
        <h2 className="text-lg font-semibold text-slate-200 mb-3">Domaines actifs</h2>
        {loading ? (
          <div className="text-slate-400 text-sm">Chargement…</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {activeDomains.map(d => (
              <div key={d.domain} className="p-3 bg-slate-800 rounded-lg border border-slate-700">
                <code className="text-xs font-mono text-slate-300">{d.domain}</code>
                <div className="text-xs text-slate-500 mt-1">{d.count} article{d.count > 1 ? 's' : ''}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Historique (non-pending) */}
      {pending.filter(d => d.status !== 'pending').length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-slate-200 mb-3">Historique des domaines traités</h2>
          <div className="space-y-2">
            {pending
              .filter(d => d.status !== 'pending')
              .map(domain => {
                const cfg = statusConfig[domain.status] ?? statusConfig.pending
                return (
                  <div key={domain.id} className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg border border-slate-700">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${cfg.className}`}>{cfg.label}</span>
                    <code className="text-xs font-mono text-slate-300">{domain.suggested_name}</code>
                    <span className="text-sm text-slate-400">{domain.suggested_label}</span>
                    {domain.merged_into && (
                      <span className="text-xs text-slate-500">→ {domain.merged_into}</span>
                    )}
                    <span className="ml-auto text-xs text-slate-500">
                      {domain.article_count} art.
                    </span>
                  </div>
                )
              })}
          </div>
        </section>
      )}
    </div>
  )
}
